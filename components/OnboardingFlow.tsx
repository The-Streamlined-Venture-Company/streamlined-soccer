import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useClub } from '../contexts/ClubContext';
import TimezonePicker from './admin/TimezonePicker';
import { ButtonSpinner } from './ui/LoadingSpinner';
import ErrorMessage from './ui/ErrorMessage';

const PERSONA_PRESETS: { id: string; label: string; persona: string }[] = [
  {
    id: 'pitch-bot',
    label: 'Pitch Bot — friendly & efficient',
    persona: 'You are Pitch Bot, the friendly organiser for our weekly football. Keep messages short, clear, and upbeat. Use light emoji where it helps.',
  },
  {
    id: 'cap',
    label: 'Captain — focused & competitive',
    persona: 'You are the team captain. Keep messages crisp, no-nonsense, and focused on getting the squad ready. Mention pride and accountability.',
  },
  {
    id: 'banter',
    label: 'Banter Bot — fun & cheeky',
    persona: 'You are the squad banter bot. Cheeky, warm, lots of light humour and football references — never mean. Keep it short.',
  },
];

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type Step = 'name' | 'timezone' | 'persona';

const OnboardingFlow: React.FC = () => {
  const { user, signOut } = useAuth();
  const { createClub, isSaving, error } = useClub();

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(detectBrowserTimezone());
  const [personaId, setPersonaId] = useState(PERSONA_PRESETS[0].id);
  const [customPersona, setCustomPersona] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const friendlyEmail = user?.email?.split('@')[0];

  const trimmedName = name.trim();

  const persona = useMemo(() => {
    if (personaId === 'custom') return customPersona.trim() || PERSONA_PRESETS[0].persona;
    return PERSONA_PRESETS.find(p => p.id === personaId)?.persona ?? PERSONA_PRESETS[0].persona;
  }, [personaId, customPersona]);

  useEffect(() => {
    if (error) setSubmitError(error);
  }, [error]);

  const goNext = () => {
    setSubmitError(null);
    if (step === 'name') {
      if (trimmedName.length < 2) {
        setSubmitError('Give your club a name (at least 2 characters)');
        return;
      }
      setStep('timezone');
    } else if (step === 'timezone') {
      setStep('persona');
    }
  };

  const goBack = () => {
    setSubmitError(null);
    if (step === 'timezone') setStep('name');
    else if (step === 'persona') setStep('timezone');
  };

  const handleCreate = async () => {
    if (trimmedName.length < 2) {
      setSubmitError('Give your club a name first');
      setStep('name');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const created = await createClub(trimmedName, timezone, persona);
    setSubmitting(false);
    if (!created) {
      setSubmitError(error ?? 'Could not create the club. Try again.');
    }
    // On success ClubContext refreshes, currentClubId is set, App routes us out of onboarding.
  };

  const StepDots: React.FC = () => {
    const stepIndex = step === 'name' ? 0 : step === 'timezone' ? 1 : 2;
    return (
      <div className="flex items-center justify-center gap-2 mb-8">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === stepIndex
                ? 'w-8 bg-emerald-400'
                : i < stepIndex
                  ? 'w-1.5 bg-emerald-600'
                  : 'w-1.5 bg-slate-700'
            }`}
          />
        ))}
      </div>
    );
  };

  const HeroBadge: React.FC = () => (
    <div className="flex items-center justify-center mb-6">
      <div className="relative">
        <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center shadow-lg">
          <svg className="w-3.5 h-3.5 text-amber-900" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-4 pt-16 sm:pt-4">
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => void signOut()}
          className="text-xs text-slate-500 hover:text-slate-300 font-medium tracking-wide"
        >
          Sign out
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter text-white uppercase italic leading-none">
            STREAMLINED<span className="text-emerald-400"> SOCCER</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase mt-2">
            Smart Lineup Management
          </p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
          <HeroBadge />
          <StepDots />

          {step === 'name' && (
            <div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tight text-center">
                Welcome{friendlyEmail ? `, ${friendlyEmail}` : ''}!
              </h2>
              <p className="text-sm text-slate-400 mt-2 text-center">
                Let's get your club set up. Takes about 30 seconds.
              </p>

              <div className="mt-8">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
                  What's your club called?
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && trimmedName.length >= 2) goNext();
                  }}
                  placeholder="e.g. Sunday League FC"
                  autoFocus
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-white text-base placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
                <p className="text-[11px] text-slate-500 mt-2">
                  This is the group of players who play together regularly. You can rename it later.
                </p>
              </div>

              {submitError && <div className="mt-4"><ErrorMessage error={submitError} /></div>}

              <button
                onClick={goNext}
                disabled={trimmedName.length < 2}
                className="w-full mt-6 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-6 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all border-b-4 border-emerald-700 disabled:border-slate-800 active:scale-[0.99]"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'timezone' && (
            <div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tight text-center">
                When do you play?
              </h2>
              <p className="text-sm text-slate-400 mt-2 text-center">
                Pick your timezone so reminders and posts go out at the right local time.
              </p>

              <div className="mt-8">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
                  Timezone
                </label>
                <TimezonePicker value={timezone} onChange={setTimezone} />
              </div>

              {submitError && <div className="mt-4"><ErrorMessage error={submitError} /></div>}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={goBack}
                  className="px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-black text-sm uppercase tracking-widest transition-all border-b-4 border-slate-900 active:scale-[0.99]"
                >
                  Back
                </button>
                <button
                  onClick={goNext}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all border-b-4 border-emerald-700 active:scale-[0.99]"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'persona' && (
            <div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tight text-center">
                Pick your bot's vibe
              </h2>
              <p className="text-sm text-slate-400 mt-2 text-center">
                How should the bot sound when it talks to your group? You can fine-tune this later.
              </p>

              <div className="mt-6 space-y-2">
                {PERSONA_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => setPersonaId(preset.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      personaId === preset.id
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                        : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                          personaId === preset.id ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'
                        }`}
                      />
                      <span className="text-sm font-medium">{preset.label}</span>
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => setPersonaId('custom')}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                    personaId === 'custom'
                      ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                      : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                        personaId === 'custom' ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'
                      }`}
                    />
                    <span className="text-sm font-medium">Custom — write your own</span>
                  </div>
                </button>
              </div>

              {personaId === 'custom' && (
                <textarea
                  value={customPersona}
                  onChange={e => setCustomPersona(e.target.value)}
                  placeholder="Describe how the bot should write..."
                  rows={3}
                  className="w-full mt-3 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition resize-none"
                />
              )}

              {submitError && <div className="mt-4"><ErrorMessage error={submitError} /></div>}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={goBack}
                  disabled={submitting || isSaving}
                  className="px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-black text-sm uppercase tracking-widest transition-all border-b-4 border-slate-900 active:scale-[0.99] disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={submitting || isSaving}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700 text-white px-6 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all border-b-4 border-emerald-700 active:scale-[0.99] flex items-center justify-center gap-2"
                >
                  {submitting || isSaving ? (
                    <>
                      <ButtonSpinner />
                      Creating...
                    </>
                  ) : (
                    <>Create Club</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-slate-600 font-black uppercase tracking-[0.3em] mt-8">
          You're the owner • You can invite others later
        </p>
      </div>
    </div>
  );
};

export default OnboardingFlow;
