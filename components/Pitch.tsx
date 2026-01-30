
import React from 'react';

const Pitch: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative w-full h-full border-[8px] border-white/95 overflow-hidden shadow-[0_30px_60px_-12px_rgba(0,0,0,0.7)] rounded-sm group">
      {/* Base Grass Layer - Updated to a more vibrant green for better contrast with black kits */}
      <div 
        className="absolute inset-0 bg-[#1b5e20]"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              135deg,
              rgba(0, 0, 0, 0.04) 0px,
              rgba(0, 0, 0, 0.04) 10%,
              transparent 10%,
              transparent 20%
            ),
            repeating-linear-gradient(
              45deg,
              rgba(255, 255, 255, 0.01) 0px,
              rgba(255, 255, 255, 0.01) 10%,
              transparent 10%,
              transparent 20%
            ),
            url('https://www.transparenttextures.com/patterns/grass.png')
          `,
          backgroundSize: '200% 200%, 200% 200%, 300px 300px'
        }}
      />
      
      {/* Stadium Floodlight Effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/10 blur-[120px] rounded-full" />
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-400/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400/5 blur-[120px] rounded-full" />
      </div>

      {/* Field Markings */}
      <div className="absolute inset-0 pointer-events-none opacity-85">
        {/* Center Line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-2 bg-white/90 -translate-x-1/2 shadow-[0_0_10px_rgba(255,255,255,0.2)]" />
        
        {/* Center Circle */}
        <div className="absolute left-1/2 top-1/2 w-[28%] aspect-square border-[3.5px] border-white/90 rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
           <div className="w-4 h-4 bg-white/90 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.4)]" />
        </div>

        {/* Penalty Areas (Left) */}
        <div className="absolute left-0 top-1/4 bottom-1/4 w-[16%] border-y-[3.5px] border-r-[3.5px] border-white/90">
            {/* Penalty Arc (The D) */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-[60%] aspect-square border-[3.5px] border-white/90 rounded-full clip-path-arc-left" 
                 style={{ clipPath: 'inset(0 0 0 50%)' }} />
            {/* Penalty Spot */}
            <div className="absolute right-[25%] top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white/90 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)]" />
        </div>
        {/* Goal Area (Left) */}
        <div className="absolute left-0 top-[38%] bottom-[38%] w-[6%] border-y-[3.5px] border-r-[3.5px] border-white/90 bg-white/5" />

        {/* Penalty Areas (Right) */}
        <div className="absolute right-0 top-1/4 bottom-1/4 w-[16%] border-y-[3.5px] border-l-[3.5px] border-white/90">
            {/* Penalty Arc (The D) */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-[60%] aspect-square border-[3.5px] border-white/90 rounded-full" 
                 style={{ clipPath: 'inset(0 50% 0 0)' }} />
            {/* Penalty Spot */}
            <div className="absolute left-[25%] top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white/90 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.4)]" />
        </div>
        {/* Goal Area (Right) */}
        <div className="absolute right-0 top-[38%] bottom-[38%] w-[6%] border-y-[3.5px] border-l-[3.5px] border-white/90 bg-white/5" />

        {/* Corner Arcs */}
        <div className="absolute top-0 left-0 w-[5%] aspect-square border-b-[3.5px] border-r-[3.5px] border-white/90 rounded-br-full" />
        <div className="absolute bottom-0 left-0 w-[5%] aspect-square border-t-[3.5px] border-r-[3.5px] border-white/90 rounded-tr-full" />
        <div className="absolute top-0 right-0 w-[5%] aspect-square border-b-[3.5px] border-l-[3.5px] border-white/90 rounded-bl-full" />
        <div className="absolute bottom-0 right-0 w-[5%] aspect-square border-t-[3.5px] border-l-[3.5px] border-white/90 rounded-tl-full" />
      </div>

      {/* Goal Nets (Visual only) */}
      <div className="absolute left-[-20px] top-[38%] bottom-[38%] w-[20px] border-y-[2px] border-r-[2px] border-white/40 overflow-hidden">
         <div className="w-full h-full opacity-20" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '4px 4px' }} />
      </div>
      <div className="absolute right-[-20px] top-[38%] bottom-[38%] w-[20px] border-y-[2px] border-l-[2px] border-white/40 overflow-hidden">
         <div className="w-full h-full opacity-20" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '4px 4px' }} />
      </div>

      {/* Vignette for depth - Adjusted for brighter pitch */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-black/10 pointer-events-none" />

      {/* Content */}
      <div className="relative w-full h-full z-10">
        {children}
      </div>
    </div>
  );
};

export default Pitch;
