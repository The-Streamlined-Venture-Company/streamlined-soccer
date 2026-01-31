import React, { useState, useEffect } from 'react';
import { Player, PlayerInsert, PlayerUpdate, PreferredPosition, PlayerStatus } from '../../types/database';
import { usePlayers } from '../../hooks/usePlayers';
import LoadingSpinner from '../ui/LoadingSpinner';
import ErrorMessage from '../ui/ErrorMessage';

// Hook to detect mobile viewport
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

interface PlayerManagerProps {
  onClose?: () => void;
}

// Skill rating display with color coding
const SkillCell: React.FC<{ value: number; editing?: boolean; onChange?: (val: number) => void }> = ({
  value,
  editing,
  onChange
}) => {
  if (editing && onChange) {
    return (
      <input
        type="number"
        min="0"
        max="10"
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="w-10 bg-slate-950 border border-emerald-500/50 rounded px-1 py-0.5 text-xs text-center text-white"
      />
    );
  }

  const getColor = (v: number) => {
    if (v >= 8) return 'text-emerald-400 bg-emerald-500/20';
    if (v >= 6) return 'text-amber-400 bg-amber-500/20';
    if (v >= 4) return 'text-slate-300 bg-slate-500/20';
    return 'text-red-400 bg-red-500/20';
  };

  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${getColor(value)}`}>
      {value}
    </span>
  );
};

const PlayerManager: React.FC<PlayerManagerProps> = ({ onClose }) => {
  const isMobile = useIsMobile();
  const { players, isLoading, error, addPlayer, updatePlayer, deletePlayer, refresh } = usePlayers();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlayerUpdate>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPlayer, setNewPlayer] = useState<PlayerInsert>({
    name: '',
    status: 'regular',
    preferred_position: 'everywhere',
    shooting: 5,
    passing: 5,
    ball_control: 5,
    playmaking: 5,
    defending: 5,
    fitness: 5,
    is_linchpin: false,
    aliases: [],
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<PlayerStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<'overall_score' | 'name'>('overall_score');

  // Filter and sort players
  const filteredPlayers = players
    .filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.aliases?.some(a => a.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'overall_score') return b.overall_score - a.overall_score;
      return a.name.localeCompare(b.name);
    });

  // Handle edit
  const startEdit = (player: Player) => {
    setEditingId(player.id);
    setEditForm({
      name: player.name,
      status: player.status,
      preferred_position: player.preferred_position,
      shooting: player.shooting,
      passing: player.passing,
      ball_control: player.ball_control,
      playmaking: player.playmaking,
      defending: player.defending,
      fitness: player.fitness,
      is_linchpin: player.is_linchpin,
      notes: player.notes,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updatePlayer(editingId, editForm);
    setEditingId(null);
    setEditForm({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // Handle add
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayer.name.trim()) return;

    await addPlayer(newPlayer);
    setNewPlayer({
      name: '',
      status: 'regular',
      preferred_position: 'everywhere',
      shooting: 5,
      passing: 5,
      ball_control: 5,
      playmaking: 5,
      defending: 5,
      fitness: 5,
      is_linchpin: false,
      aliases: [],
    });
    setShowAddForm(false);
  };

  // Handle delete
  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Delete ${name}?`)) {
      await deletePlayer(id);
    }
  };

  // Get position badge color
  const getPositionColor = (position: PreferredPosition) => {
    switch (position) {
      case 'attacking': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'midfield': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'defensive': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  // Get status badge
  const getStatusBadge = (status: PlayerStatus) => {
    switch (status) {
      case 'newbie': return <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase font-bold">New</span>;
      case 'inactive': return <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/30 text-slate-500 uppercase font-bold">Out</span>;
      default: return null;
    }
  };

  // Get position short label
  const getPositionLabel = (position: PreferredPosition) => {
    switch (position) {
      case 'attacking': return 'ATT';
      case 'midfield': return 'MID';
      case 'defensive': return 'DEF';
      default: return 'ALL';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner label="Loading players..." />
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-900/80 backdrop-blur-xl border border-white/5 rounded-3xl p-4 md:p-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Player Database</h3>
            <p className="text-xs text-slate-500">{players.length} players • {filteredPlayers.length} shown</p>
          </div>
        </div>

        {onClose && (
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-all">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Error message */}
      {error && <ErrorMessage error={error} variant="banner" />}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search..."
          className="flex-1 min-w-[120px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-3 text-sm text-white focus:border-emerald-500/50 focus:outline-none min-h-[44px]"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as PlayerStatus | 'all')}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-3 text-sm text-white min-h-[44px]"
        >
          <option value="all">All</option>
          <option value="regular">Regular</option>
          <option value="newbie">Newbie</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'overall_score' | 'name')}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-3 text-sm text-white min-h-[44px]"
        >
          <option value="overall_score">By Rating</option>
          <option value="name">By Name</option>
        </select>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase transition-all min-h-[44px] touch-target"
        >
          + Add
        </button>
        <button
          onClick={refresh}
          className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold uppercase transition-all min-h-[44px] touch-target"
        >
          ↻
        </button>
      </div>

      {/* Add player form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-4 p-4 bg-slate-950 rounded-xl border border-emerald-500/20">
          <h4 className="text-sm font-black text-emerald-400 uppercase tracking-widest mb-3">Add New Player</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <input
              type="text"
              value={newPlayer.name}
              onChange={e => setNewPlayer({ ...newPlayer, name: e.target.value })}
              placeholder="Name..."
              required
              className="col-span-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
            />
            <select
              value={newPlayer.status}
              onChange={e => setNewPlayer({ ...newPlayer, status: e.target.value as PlayerStatus })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="regular">Regular</option>
              <option value="newbie">Newbie</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={newPlayer.preferred_position}
              onChange={e => setNewPlayer({ ...newPlayer, preferred_position: e.target.value as PreferredPosition })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="everywhere">Everywhere</option>
              <option value="attacking">Attacking</option>
              <option value="midfield">Midfield</option>
              <option value="defensive">Defensive</option>
            </select>
          </div>

          <div className="grid grid-cols-6 gap-2 mb-3">
            {(['shooting', 'passing', 'ball_control', 'playmaking', 'defending', 'fitness'] as const).map(skill => (
              <div key={skill} className="text-center">
                <label className="block text-[8px] text-slate-500 uppercase mb-1">
                  {skill === 'ball_control' ? 'CTR' : skill.slice(0, 3).toUpperCase()}
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={newPlayer[skill] as number}
                  onChange={e => setNewPlayer({ ...newPlayer, [skill]: parseInt(e.target.value) || 0 })}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm text-emerald-400 text-center"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newPlayer.is_linchpin}
                onChange={e => setNewPlayer({ ...newPlayer, is_linchpin: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-500"
              />
              <span className="text-xs text-slate-400">★ Linchpin</span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-3 py-1.5 bg-slate-800 text-white rounded text-xs font-bold uppercase">
                Cancel
              </button>
              <button type="submit" className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-bold uppercase">
                Add
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Mobile Card View */}
      {isMobile ? (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {filteredPlayers.map((player, idx) => {
            const isEditing = editingId === player.id;
            const isExpanded = expandedId === player.id;

            return (
              <div
                key={player.id}
                className={`bg-slate-950 rounded-xl border border-slate-800 overflow-hidden ${
                  player.status === 'inactive' ? 'opacity-50' : ''
                }`}
              >
                {/* Card Header - always visible */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer active:bg-slate-800/50"
                  onClick={() => !isEditing && setExpandedId(isExpanded ? null : player.id)}
                >
                  {/* Rank */}
                  <span className="text-[10px] text-slate-600 w-4">{idx + 1}</span>

                  {/* Overall Rating */}
                  <span className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-black ${
                    player.overall_score >= 80 ? 'bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50' :
                    player.overall_score >= 70 ? 'bg-emerald-500/20 text-emerald-400' :
                    player.overall_score >= 60 ? 'bg-slate-500/20 text-slate-300' :
                    'bg-slate-800 text-slate-500'
                  }`}>
                    {player.overall_score}
                  </span>

                  {/* Name and badges */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editForm.name || ''}
                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        onClick={e => e.stopPropagation()}
                        className="bg-slate-900 border border-emerald-500/50 rounded px-2 py-1 text-sm text-white w-full"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">{player.name}</span>
                        {player.is_linchpin && <span className="text-amber-400 text-sm">★</span>}
                        {getStatusBadge(player.status)}
                      </div>
                    )}
                  </div>

                  {/* Position badge */}
                  <span className={`flex-shrink-0 px-2 py-1 rounded text-[10px] font-bold border ${getPositionColor(player.preferred_position)}`}>
                    {getPositionLabel(player.preferred_position)}
                  </span>

                  {/* Expand indicator */}
                  {!isEditing && (
                    <svg
                      className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </div>

                {/* Expanded content */}
                {(isExpanded || isEditing) && (
                  <div className="px-3 pb-3 border-t border-slate-800">
                    {/* Skills grid */}
                    <div className="grid grid-cols-6 gap-2 py-3">
                      {(['shooting', 'passing', 'ball_control', 'playmaking', 'defending', 'fitness'] as const).map(skill => (
                        <div key={skill} className="text-center">
                          <div className="text-[8px] text-slate-500 uppercase mb-1">
                            {skill === 'ball_control' ? 'CTR' : skill.slice(0, 3).toUpperCase()}
                          </div>
                          <SkillCell
                            value={isEditing ? (editForm[skill] ?? player[skill]) : player[skill]}
                            editing={isEditing}
                            onChange={v => setEditForm({ ...editForm, [skill]: v })}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Edit mode extras */}
                    {isEditing && (
                      <div className="flex items-center gap-3 py-2 border-t border-slate-800">
                        <select
                          value={editForm.preferred_position || player.preferred_position}
                          onChange={e => setEditForm({ ...editForm, preferred_position: e.target.value as PreferredPosition })}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white flex-1"
                        >
                          <option value="everywhere">Everywhere</option>
                          <option value="attacking">Attacking</option>
                          <option value="midfield">Midfield</option>
                          <option value="defensive">Defensive</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => setEditForm({ ...editForm, is_linchpin: !editForm.is_linchpin })}
                          className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                            editForm.is_linchpin
                              ? 'bg-amber-500/30 text-amber-400'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          ★ Linchpin
                        </button>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={saveEdit}
                            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase transition-all touch-target"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold uppercase transition-all touch-target"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEdit(player); }}
                            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 transition-all touch-target"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(player.id, player.name); }}
                            className="py-2.5 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-bold uppercase transition-all touch-target"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredPlayers.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-slate-600 text-sm">No players found</p>
            </div>
          )}
        </div>
      ) : (
        /* Desktop Table View */
        <div className="overflow-auto -mx-4 md:mx-0 max-h-[60vh]">
          <table className="w-full min-w-[700px]">
            <thead className="sticky top-0 z-10 bg-slate-900">
              <tr className="text-[9px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                <th className="text-center py-2 px-1 w-12">OVR</th>
                <th className="text-left py-2 px-2">Player</th>
                <th className="text-center py-2 px-1 w-12">POS</th>
                <th className="text-center py-2 px-1 w-8">SHO</th>
                <th className="text-center py-2 px-1 w-8">PAS</th>
                <th className="text-center py-2 px-1 w-8">CTR</th>
                <th className="text-center py-2 px-1 w-8">PLY</th>
                <th className="text-center py-2 px-1 w-8">DEF</th>
                <th className="text-center py-2 px-1 w-8">FIT</th>
                <th className="text-center py-2 px-1 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map((player, idx) => {
                const isEditing = editingId === player.id;
                return (
                  <tr
                    key={player.id}
                    className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${
                      player.status === 'inactive' ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Overall Rating */}
                    <td className="py-2 px-1 text-center">
                      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-black ${
                        player.overall_score >= 80 ? 'bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50' :
                        player.overall_score >= 70 ? 'bg-emerald-500/20 text-emerald-400' :
                        player.overall_score >= 60 ? 'bg-slate-500/20 text-slate-300' :
                        'bg-slate-800 text-slate-500'
                      }`}>
                        {player.overall_score}
                      </span>
                    </td>

                    {/* Player Name */}
                    <td className="py-2 px-2">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editForm.name || ''}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            className="bg-slate-950 border border-emerald-500/50 rounded px-2 py-1 text-sm text-white w-full max-w-[120px]"
                          />
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, is_linchpin: !editForm.is_linchpin })}
                            className={`p-1 rounded transition-all ${editForm.is_linchpin ? 'bg-amber-500/30 text-amber-400' : 'bg-slate-800 text-slate-600 hover:text-slate-400'}`}
                            title="Toggle Linchpin"
                          >
                            ★
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-600 w-4">{idx + 1}</span>
                          <span className="text-sm font-bold text-white">{player.name}</span>
                          {player.is_linchpin && <span className="text-amber-400">★</span>}
                          {getStatusBadge(player.status)}
                        </div>
                      )}
                    </td>

                    {/* Position */}
                    <td className="py-2 px-1 text-center">
                      {isEditing ? (
                        <select
                          value={editForm.preferred_position || player.preferred_position}
                          onChange={e => setEditForm({ ...editForm, preferred_position: e.target.value as PreferredPosition })}
                          className="bg-slate-950 border border-emerald-500/50 rounded px-1 py-0.5 text-[10px] text-white w-14"
                        >
                          <option value="everywhere">ALL</option>
                          <option value="attacking">ATT</option>
                          <option value="midfield">MID</option>
                          <option value="defensive">DEF</option>
                        </select>
                      ) : (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold border ${getPositionColor(player.preferred_position)}`}>
                          {getPositionLabel(player.preferred_position)}
                        </span>
                      )}
                    </td>

                    {/* Skills */}
                    <td className="py-2 px-1 text-center">
                      <SkillCell
                        value={isEditing ? (editForm.shooting ?? player.shooting) : player.shooting}
                        editing={isEditing}
                        onChange={v => setEditForm({ ...editForm, shooting: v })}
                      />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <SkillCell
                        value={isEditing ? (editForm.passing ?? player.passing) : player.passing}
                        editing={isEditing}
                        onChange={v => setEditForm({ ...editForm, passing: v })}
                      />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <SkillCell
                        value={isEditing ? (editForm.ball_control ?? player.ball_control) : player.ball_control}
                        editing={isEditing}
                        onChange={v => setEditForm({ ...editForm, ball_control: v })}
                      />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <SkillCell
                        value={isEditing ? (editForm.playmaking ?? player.playmaking) : player.playmaking}
                        editing={isEditing}
                        onChange={v => setEditForm({ ...editForm, playmaking: v })}
                      />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <SkillCell
                        value={isEditing ? (editForm.defending ?? player.defending) : player.defending}
                        editing={isEditing}
                        onChange={v => setEditForm({ ...editForm, defending: v })}
                      />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <SkillCell
                        value={isEditing ? (editForm.fitness ?? player.fitness) : player.fitness}
                        editing={isEditing}
                        onChange={v => setEditForm({ ...editForm, fitness: v })}
                      />
                    </td>

                    {/* Actions */}
                    <td className="py-2 px-1 text-center">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={saveEdit}
                            className="p-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded transition-all"
                            title="Save"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1 bg-slate-500/20 hover:bg-slate-500/30 text-slate-400 rounded transition-all"
                            title="Cancel"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => startEdit(player)}
                            className="p-1 hover:bg-slate-800 text-slate-500 hover:text-white rounded transition-all"
                            title="Edit"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(player.id, player.name)}
                            className="p-1 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded transition-all"
                            title="Delete"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredPlayers.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-slate-600 text-sm">No players found</p>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap gap-4 text-[10px] text-slate-500">
        <span>Skills: <span className="text-emerald-400">8-10</span> Elite • <span className="text-amber-400">6-7</span> Good • <span className="text-slate-300">4-5</span> Average • <span className="text-red-400">0-3</span> Weak</span>
        <span>★ = Linchpin</span>
      </div>
    </div>
  );
};

export default PlayerManager;
