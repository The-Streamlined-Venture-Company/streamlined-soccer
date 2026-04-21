/**
 * Minimal Scheduler — Checks Supabase every 60s for due WhatsApp schedules
 *
 * Reads agent_schedules where template_id LIKE 'template-whatsapp-%'
 * and fires polls/messages via the WhatsApp client. This runs on the relay
 * server so scheduled sends work even when the Electron app is closed.
 *
 * Security: uses the user's own session (anon key + JWT) — RLS enforces
 * that the scheduler can only see/modify the authenticated user's schedules.
 *
 * Auth flow:
 *   1. Relay spawns with SUPABASE_URL + SUPABASE_ANON_KEY (both public)
 *   2. Electron app sends JWT via POST /auth after user signs in
 *   3. Scheduler creates a Supabase client with setSession() — RLS active
 *   4. On TOKEN_REFRESHED, app sends new JWT — scheduler updates session
 *
 * Reliability: atomic claim via optimistic lock on next_run_at, cron-parser for scheduling.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import cronParser from 'cron-parser';
import type { WhatsAppClient } from './whatsapp.js';
import type { TenantManager } from './tenantManager.js';

interface ScheduleRow {
  id: string;
  template_id: string;
  is_paused: boolean;
  next_run_at: string;
  cron_expression: string;
  consecutive_failures: number;
  user_id: string;
  metadata: {
    templateConfig?: {
      groupJid?: string;
      groupName?: string;
      question?: string;
      options?: string[];
      selectableCount?: number;
      text?: string;
      jid?: string;
    };
  } | null;
}

/** Options for multi-tenant scheduler mode */
export interface SchedulerMultiTenantOptions {
  multiTenant: boolean;
  tenantManager: TenantManager;
  /** Use service role key (bypasses RLS) for cross-user schedule queries */
  useServiceRole: boolean;
}

const CHECK_INTERVAL_MS = 60_000; // 60 seconds
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_CONNECTION_WAIT_MS = 30_000; // Max wait for Baileys connection
const CONNECTION_POLL_MS = 1_000; // Check readiness every 1s

export class RelayScheduler {
  private supabase: SupabaseClient | null = null;
  private client: WhatsAppClient | null;
  private timer: NodeJS.Timeout | null = null;
  private userId: string | null = null;
  private supabaseUrl: string;
  private supabaseKey: string;
  private multiTenantOptions: SchedulerMultiTenantOptions | null;
  private tickRunning = false;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    client: WhatsAppClient | null,
    multiTenantOptions?: SchedulerMultiTenantOptions,
  ) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.client = client;
    this.multiTenantOptions = multiTenantOptions ?? null;

    // In multi-tenant mode with service role, create the Supabase client immediately
    if (this.multiTenantOptions?.useServiceRole) {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }
  }

  /**
   * Update auth credentials. Creates/updates the Supabase client with the
   * user's session. Starts the polling timer on first auth.
   */
  async updateAuth(accessToken: string, refreshToken: string, userId: string): Promise<void> {
    this.userId = userId;

    // Reuse existing client if same user, create new one if first auth or user changed
    if (!this.supabase) {
      this.supabase = createClient(this.supabaseUrl, this.supabaseKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: false,  // Relay is stateless — app sends fresh tokens
        },
      });
    }

    const { error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('[Scheduler] Failed to set session:', error.message);
      this.supabase = null;
      this.userId = null;
      return;
    }

    console.log(`[Scheduler] Auth updated for user ${userId.slice(0, 8)}...`);

    // Start polling if not already running
    if (!this.timer) {
      this.start();
    }
  }

  /** Clear auth and stop polling */
  clearAuth(): void {
    console.log('[Scheduler] Auth cleared, stopping');
    this.stop();
    this.supabase = null;
    this.userId = null;
  }

  /** Whether the scheduler has valid auth and is polling */
  get isActive(): boolean {
    return this.supabase !== null && this.userId !== null && this.timer !== null;
  }

  start(): void {
    if (this.timer) return; // Already running
    console.log('[Scheduler] Started (checking every 60s)');
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    // Run immediately on start
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.supabase) return;
    if (this.tickRunning) return; // Prevent overlapping ticks
    this.tickRunning = true;

    try {
      await this.tickInner();
    } finally {
      this.tickRunning = false;
    }
  }

  private async tickInner(): Promise<void> {
    if (!this.supabase) return;

    // In single-tenant mode, require both client readiness and userId
    if (!this.multiTenantOptions) {
      if (!this.client?.isReady()) return;
      if (!this.userId) return;
    }

    // Track which users have active schedules this tick (for multi-tenant marker cleanup)
    const activeUserIds = new Set<string>();

    try {
      const now = new Date().toISOString();

      // Build query — multi-tenant queries ALL users, single-tenant filters by userId
      let query = this.supabase
        .from('agent_schedules')
        .select('id, template_id, is_paused, next_run_at, cron_expression, consecutive_failures, user_id, metadata')
        .like('template_id', 'template-whatsapp-%')
        .eq('is_paused', false)
        .lte('next_run_at', now);

      // Single-tenant: filter by authenticated user
      if (!this.multiTenantOptions && this.userId) {
        query = query.eq('user_id', this.userId);
      }

      const { data: schedules, error } = await query;

      if (error) {
        console.error('[Scheduler] Query error:', error.message);
        return;
      }

      if (!schedules || schedules.length === 0) return;

      for (const schedule of schedules as ScheduleRow[]) {
        // Circuit breaker: skip schedules with too many consecutive failures
        if ((schedule.consecutive_failures ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
          console.warn(`[Scheduler] Schedule ${schedule.id} circuit-broken (${schedule.consecutive_failures} failures), pausing`);
          await this.supabase
            .from('agent_schedules')
            .update({ is_paused: true })
            .eq('id', schedule.id);
          continue;
        }

        activeUserIds.add(schedule.user_id);
        await this.execute(schedule);
      }
    } catch (error) {
      console.error('[Scheduler] Tick error:', error);
    } finally {
      // Always update active schedule markers — even on error, stale markers must be cleared
      if (this.multiTenantOptions) {
        for (const userId of this.multiTenantOptions.tenantManager.tenantUserIds) {
          if (activeUserIds.has(userId)) {
            this.multiTenantOptions.tenantManager.markActiveSchedule(userId);
          } else {
            this.multiTenantOptions.tenantManager.clearActiveSchedule(userId);
          }
        }
      }
    }
  }

  /**
   * Resolve the WhatsApp client for executing a schedule.
   * Single-tenant: uses the shared client.
   * Multi-tenant: resolves from TenantManager by user_id, lazy-creates if needed.
   */
  private resolveClient(schedule: ScheduleRow): WhatsAppClient | null {
    if (this.multiTenantOptions) {
      const session = this.multiTenantOptions.tenantManager.getOrCreate(schedule.user_id);
      // Mark this user as having active schedules (prevents idle eviction)
      this.multiTenantOptions.tenantManager.markActiveSchedule(schedule.user_id);
      return session.client;
    }
    return this.client;
  }

  private async execute(schedule: ScheduleRow): Promise<void> {
    if (!this.supabase) return;

    const config = schedule.metadata?.templateConfig;
    if (!config) {
      console.warn(`[Scheduler] Schedule ${schedule.id} has no templateConfig`);
      return;
    }

    // Resolve the WhatsApp client for this schedule's user
    const execClient = this.resolveClient(schedule);
    if (!execClient) {
      console.warn(`[Scheduler] No client available for schedule ${schedule.id}`);
      return;
    }

    // In multi-tenant mode, the client may need to connect first
    if (this.multiTenantOptions && !execClient.isReady()) {
      try {
        console.log(`[Scheduler] Lazy-connecting client for user ${schedule.user_id.slice(0, 8)}...`);
        await execClient.connect();

        // Poll for readiness instead of hardcoded sleep
        const deadline = Date.now() + MAX_CONNECTION_WAIT_MS;
        while (!execClient.isReady() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, CONNECTION_POLL_MS));
        }

        if (!execClient.isReady()) {
          console.warn(`[Scheduler] Client not ready after ${MAX_CONNECTION_WAIT_MS / 1000}s for user ${schedule.user_id.slice(0, 8)}`);
          // Track failure and advance next_run_at to prevent rapid retry loop
          if (this.supabase) {
            const nextRun = this.calculateNextRun(schedule.cron_expression);
            const currentFailures = schedule.consecutive_failures ?? 0;
            await this.supabase
              .from('agent_schedules')
              .update({ consecutive_failures: currentFailures + 1, next_run_at: nextRun.toISOString() })
              .eq('id', schedule.id);
          }
          return;
        }
      } catch (err) {
        console.error(`[Scheduler] Failed to connect client for user ${schedule.user_id.slice(0, 8)}:`, err);
        // Track failure and advance next_run_at to prevent rapid retry loop
        if (this.supabase) {
          const nextRun = this.calculateNextRun(schedule.cron_expression);
          const currentFailures = schedule.consecutive_failures ?? 0;
          await this.supabase
            .from('agent_schedules')
            .update({ consecutive_failures: currentFailures + 1, next_run_at: nextRun.toISOString() })
            .eq('id', schedule.id);
        }
        return;
      }
    } else if (!this.multiTenantOptions && !execClient.isReady()) {
      return; // Single-tenant: client not ready, skip
    }

    // Atomic claim: update next_run_at BEFORE executing (optimistic lock)
    // For one-time schedules (no cron), set next_run far in the future + auto-pause after execution
    const isOneTime = !schedule.cron_expression;
    const nextRun = isOneTime
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Far future placeholder
      : this.calculateNextRun(schedule.cron_expression);
    const { data: claimed, error: claimError } = await this.supabase
      .from('agent_schedules')
      .update({
        next_run_at: nextRun.toISOString(),
        ...(isOneTime ? { is_paused: true } : {}), // Auto-pause one-time schedules
      })
      .eq('id', schedule.id)
      .eq('next_run_at', schedule.next_run_at) // Optimistic lock — only succeeds if unchanged
      .select('id')
      .single();

    if (claimError || !claimed) {
      console.log(`[Scheduler] Schedule ${schedule.id} already claimed by another instance, skipping`);
      return;
    }

    console.log(`[Scheduler] Executing schedule ${schedule.id} (${schedule.template_id})`);

    try {
      if (schedule.template_id === 'template-whatsapp-poll') {
        const jid = config.groupJid || (config.groupName ? execClient.findGroupJid(config.groupName) : null);
        if (!jid) {
          console.error(`[Scheduler] No JID found for poll schedule ${schedule.id}`);
          return;
        }
        if (!config.question || !config.options) {
          console.error(`[Scheduler] Missing question/options for poll schedule ${schedule.id}`);
          return;
        }
        await execClient.sendPoll(jid, config.question, config.options, config.selectableCount ?? 1);
        console.log(`[Scheduler] Poll sent: "${config.question}" to ${config.groupName || jid}`);
      } else if (schedule.template_id === 'template-whatsapp-message') {
        const jid = config.jid || config.groupJid || (config.groupName ? execClient.findGroupJid(config.groupName) : null);
        if (!jid || !config.text) {
          console.error(`[Scheduler] Missing jid/text for message schedule ${schedule.id}`);
          return;
        }
        await execClient.sendMessage(jid, config.text);
        console.log(`[Scheduler] Message sent to ${config.groupName || jid}`);
      }

      // Success: update last_run_at, reset failures
      await this.supabase
        .from('agent_schedules')
        .update({
          last_run_at: new Date().toISOString(),
          consecutive_failures: 0,
        })
        .eq('id', schedule.id);

    } catch (error) {
      console.error(`[Scheduler] Failed to execute ${schedule.id}:`, error);

      if (!this.supabase) return;
      // Note: increment is non-atomic (read-then-write). Acceptable because:
      // 1. The optimistic lock on next_run_at prevents duplicate execution
      // 2. Failure paths have very low concurrency risk
      // 3. Worst case: a failure count is off by 1, which is harmless
      const currentFailures = schedule.consecutive_failures ?? 0;
      await this.supabase
        .from('agent_schedules')
        .update({
          consecutive_failures: currentFailures + 1,
        })
        .eq('id', schedule.id);
    }
  }

  /**
   * Calculate next run from a cron expression using cron-parser.
   */
  private calculateNextRun(cronExpression: string): Date {
    try {
      const interval = cronParser.parseExpression(cronExpression.trim());
      return interval.next().toDate();
    } catch (error) {
      console.warn(`[Scheduler] Failed to parse cron "${cronExpression}", defaulting to +7 days:`, error);
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  }
}
