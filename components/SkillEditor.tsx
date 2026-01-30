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

const SKILL_LABELS: Record<keyof SkillValues, string> = {
  shooting: 'SHO',
  passing: 'PAS',
  ball_control: 'CTL',
  playmaking: 'PLY',
  defending: 'DEF',
  fitness: 'FIT',
};

const SkillSlider: React.FC<{
  skill: keyof SkillValues;
  value: number;
  onChange: (skill: keyof SkillValues, value: number) => void;
}> = ({ skill, value, onChange }) => {
  const label = SKILL_LABELS[skill];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(skill, parseInt(e.target.value, 10));
  };

  // Simpler color based on value
  const getBarColor = (val: number) => {
    if (val <= 4) return 'bg-slate-500';
    if (val <= 6) return 'bg-slate-400';
    if (val <= 8) return 'bg-emerald-500';
    return 'bg-emerald-400';
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold text-slate-500 w-7 tracking-wide">{label}</span>
      <div className="flex-1 relative">
        {/* Track */}
        <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className={`h-full ${getBarColor(value)} rounded-full transition-all duration-150`}
            style={{ width: `${value * 10}%` }}
          />
        </div>
        {/* Invisible range input for interaction */}
        <input
          type="range"
          min="1"
          max="10"
          value={value}
          onChange={handleChange}
          className="absolute inset-0 w-full h-6 -top-2 opacity-0 cursor-pointer"
        />
      </div>
      <span className={`text-sm font-bold w-5 text-right tabular-nums ${value >= 8 ? 'text-emerald-400' : 'text-slate-300'}`}>
        {value}
      </span>
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
    <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700/50">
        <div>
          <h3 className="font-semibold text-white text-sm">{playerName}</h3>
          <p className="text-[10px] text-slate-500">Adjust skills</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-white">{calculateOverall()}</div>
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">OVR</div>
        </div>
      </div>

      {/* Quick set */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700/30 bg-slate-800/50">
        <span className="text-[10px] text-slate-500 mr-1">Set all:</span>
        {[5, 6, 7, 8, 9].map(val => (
          <button
            key={val}
            onClick={() => handleSetAll(val)}
            className="w-7 h-7 bg-slate-700/50 hover:bg-slate-600 text-slate-300 hover:text-white text-xs font-semibold rounded transition-colors"
          >
            {val}
          </button>
        ))}
      </div>

      {/* Skill sliders */}
      <div className="p-3 space-y-3">
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
      <div className="flex border-t border-slate-700/50">
        <button
          onClick={onDismiss}
          className="flex-1 py-2.5 text-slate-400 hover:text-white text-xs font-semibold uppercase tracking-wide transition-colors"
        >
          Skip
        </button>
        <div className="w-px bg-slate-700/50" />
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 py-2.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};

export default SkillEditor;
