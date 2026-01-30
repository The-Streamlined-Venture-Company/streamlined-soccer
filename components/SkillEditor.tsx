import React, { useState, useCallback } from 'react';

interface SkillValues {
  shooting: number;
  passing: number;
  ball_control: number;
  playmaking: number;
  defending: number;
  fitness: number;
}

interface SkillEditorProps {
  playerName: string;
  playerId: string;
  initialSkills: SkillValues;
  onSave: (playerId: string, skills: SkillValues) => Promise<void>;
  onDismiss: () => void;
}

const SKILL_LABELS: Record<keyof SkillValues, { label: string; emoji: string }> = {
  shooting: { label: 'Shooting', emoji: '⚽' },
  passing: { label: 'Passing', emoji: '🎯' },
  ball_control: { label: 'Control', emoji: '🦶' },
  playmaking: { label: 'Playmaking', emoji: '🧠' },
  defending: { label: 'Defending', emoji: '🛡️' },
  fitness: { label: 'Fitness', emoji: '💪' },
};

const SkillSlider: React.FC<{
  skill: keyof SkillValues;
  value: number;
  onChange: (skill: keyof SkillValues, value: number) => void;
}> = ({ skill, value, onChange }) => {
  const { label, emoji } = SKILL_LABELS[skill];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(skill, parseInt(e.target.value, 10));
  };

  const getColor = (val: number) => {
    if (val <= 3) return 'from-red-500 to-red-600';
    if (val <= 5) return 'from-amber-500 to-amber-600';
    if (val <= 7) return 'from-emerald-500 to-emerald-600';
    return 'from-emerald-400 to-cyan-500';
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-lg w-6">{emoji}</span>
      <div className="flex-1">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</span>
          <span className="text-sm font-bold text-white tabular-nums">{value}</span>
        </div>
        <div className="relative h-8 flex items-center">
          {/* Track background */}
          <div className="absolute inset-x-0 h-2 bg-slate-700 rounded-full" />
          {/* Filled track */}
          <div
            className={`absolute left-0 h-2 bg-gradient-to-r ${getColor(value)} rounded-full transition-all`}
            style={{ width: `${value * 10}%` }}
          />
          {/* Input slider */}
          <input
            type="range"
            min="1"
            max="10"
            value={value}
            onChange={handleChange}
            className="absolute inset-0 w-full h-8 opacity-0 cursor-pointer touch-pan-x"
          />
          {/* Thumb indicator */}
          <div
            className={`absolute w-6 h-6 bg-gradient-to-br ${getColor(value)} rounded-full shadow-lg border-2 border-white/20 pointer-events-none transition-all`}
            style={{ left: `calc(${value * 10}% - 12px)` }}
          />
        </div>
      </div>
    </div>
  );
};

const SkillEditor: React.FC<SkillEditorProps> = ({
  playerName,
  playerId,
  initialSkills,
  onSave,
  onDismiss,
}) => {
  const [skills, setSkills] = useState<SkillValues>(initialSkills);
  const [isSaving, setIsSaving] = useState(false);

  const handleSkillChange = useCallback((skill: keyof SkillValues, value: number) => {
    setSkills(prev => ({ ...prev, [skill]: value }));
  }, []);

  const calculateOverall = () => {
    const sum = skills.shooting + skills.passing + skills.ball_control +
                skills.playmaking + skills.defending + skills.fitness;
    return Math.round((sum / 6) * 10);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(playerId, skills);
      onDismiss();
    } catch (err) {
      console.error('Failed to save skills:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetAll = (value: number) => {
    setSkills({
      shooting: value,
      passing: value,
      ball_control: value,
      playmaking: value,
      defending: value,
      fitness: value,
    });
  };

  return (
    <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-700 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-white">{playerName}</h3>
          <p className="text-xs text-slate-400">Fine-tune skills or tap Done</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-emerald-400">{calculateOverall()}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Overall</div>
        </div>
      </div>

      {/* Quick set buttons */}
      <div className="flex gap-2">
        <span className="text-xs text-slate-500 self-center">Quick:</span>
        {[5, 6, 7, 8, 9].map(val => (
          <button
            key={val}
            onClick={() => handleSetAll(val)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold rounded-lg transition-colors"
          >
            {val}
          </button>
        ))}
      </div>

      {/* Skill sliders */}
      <div className="space-y-3">
        {(Object.keys(SKILL_LABELS) as Array<keyof SkillValues>).map(skill => (
          <SkillSlider
            key={skill}
            skill={skill}
            value={skills[skill]}
            onChange={handleSkillChange}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onDismiss}
          className="flex-1 py-3 text-slate-400 hover:text-white text-sm font-bold uppercase tracking-wide transition-colors"
        >
          Skip
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold uppercase tracking-wide rounded-xl transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Done'}
        </button>
      </div>
    </div>
  );
};

export default SkillEditor;
