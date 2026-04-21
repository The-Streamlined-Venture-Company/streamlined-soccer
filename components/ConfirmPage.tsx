import React, { useState } from 'react';
import { useWeeklySessionByToken } from '../hooks/useWeeklySessionByToken';
import { DAYS_OF_WEEK } from '../types/database';
import LoadingSpinner from './ui/LoadingSpinner';
import ErrorMessage from './ui/ErrorMessage';
import Auth from './Auth';
import { useAuth } from '../contexts/AuthContext';

interface ConfirmPageProps {
  token: string;
}

function formatTime(t: string): string {
  if (!t) return '';
  return t.length >= 5 ? t.substring(0, 5) : t;
}
function formatDate(d: string): string {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  } catch {
    return d;
  }
}

const ConfirmPage: React.FC<ConfirmPageProps> = ({ token }) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { weeklySession, schedule, isLoading, error, setState } = useWeeklySessionByToken(
    isAuthenticated ? token : null
  );
  const [isSaving, setIsSaving] = useState(false);

  if (authLoading) return <LoadingSpinner />;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <p className="text-slate-400 text-sm text-center mb-4">
            Sign in to manage this week's session.
          </p>
          <Auth />
        </div>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner />;

  if (error || !weeklySession || !schedule) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <ErrorMessage
            message={
              error ?? `No upcoming session found for token "${token}". It may have expired.`
            }
          />
        </div>
      </div>
    );
  }

  const handleSkip = async () => {
    setIsSaving(true);
    await setState('confirmation_declined');
    setIsSaving(false);
  };

  const handleKeepIt = async () => {
    setIsSaving(true);
    // Acknowledge — leave state as is, the runtime will fire the call-out as scheduled
    setIsSaving(false);
  };

  const isDeclined = weeklySession.state === 'confirmation_declined';
  const isCallout = ['callout_sent', 'followup_sent', 'morning_nudge_sent', 'teams_pending_approval', 'teams_posted', 'mom_sent', 'mom_closed'].includes(weeklySession.state);

  return (
    <div className="min-h-screen bg-[#020617] text-white flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black uppercase italic tracking-tighter">
            STREAMLINED<span className="text-emerald-400"> SOCCER</span>
          </h1>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              {schedule.name}
            </div>
            <div className="text-white text-xl font-semibold">
              {DAYS_OF_WEEK[schedule.kickoff_dow]} · {formatTime(schedule.kickoff_time)}
            </div>
            <div className="text-slate-400 text-sm mt-1">
              {formatDate(weeklySession.match_date)}
              {schedule.pitch_label && <> · {schedule.pitch_label}</>}
            </div>
          </div>

          {isDeclined ? (
            <div className="bg-rose-950/40 border border-rose-800/40 rounded-xl p-4 space-y-2">
              <div className="text-rose-300 text-sm font-semibold flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Skipping this week
              </div>
              <p className="text-rose-200/80 text-xs">
                The call-out will not go out. Change your mind?
              </p>
              <button
                type="button"
                onClick={() => setState('pending')}
                disabled={isSaving}
                className="w-full mt-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Undo skip
              </button>
            </div>
          ) : isCallout ? (
            <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-4">
              <div className="text-emerald-300 text-sm font-semibold flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Call-out already out
              </div>
              <p className="text-emerald-200/80 text-xs mt-1">
                Too late to skip from here. {weeklySession.signups_in} so far.
              </p>
            </div>
          ) : (
            <>
              <p className="text-slate-300 text-sm leading-relaxed">
                If nothing changes, the call-out will go out as scheduled. Tap{' '}
                <span className="text-rose-300 font-semibold">Skip this week</span> only if the
                session isn't happening.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={isSaving}
                  className="px-4 py-3 bg-rose-500 hover:bg-rose-400 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Skip this week'}
                </button>
                <button
                  type="button"
                  onClick={handleKeepIt}
                  disabled={isSaving}
                  className="px-4 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  Keep it on
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-slate-600 text-[11px] mt-6">
          Sent privately to you by the auto-organiser
        </p>
      </div>
    </div>
  );
};

export default ConfirmPage;
