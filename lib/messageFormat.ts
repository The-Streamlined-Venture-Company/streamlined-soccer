/**
 * Shared formatting helpers for outbound automated messages.
 *
 * Goal: make it easy for recipients to spot that a message was sent by the
 * auto-organiser rather than typed manually, without being intrusive.
 *
 * WhatsApp markdown:
 *   _italic_   *bold*   ~strike~   ```mono```
 */

const SIG_SEPARATOR = '\n\n';

/**
 * Append a subtle italic signature to a message body.
 *
 *   formatAutomatedMessage("Anyone for Thursday?", "Pitch Bot")
 *   → "Anyone for Thursday?\n\n_— Pitch Bot · automated_"
 */
export function formatAutomatedMessage(body: string, persona?: string | null): string {
  const sig = automatedSignature(persona);
  if (!sig) return body;
  return `${body}${SIG_SEPARATOR}${sig}`;
}

export function automatedSignature(persona?: string | null): string | null {
  const name = (persona ?? '').trim();
  if (!name) return '_— automated_';
  return `_— ${name} · automated_`;
}
