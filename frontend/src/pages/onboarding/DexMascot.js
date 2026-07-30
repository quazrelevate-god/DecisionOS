import { motion } from "framer-motion";

// Dex — the DecisionOS build engineer. A small brutalist robot that hammers
// the founder's operating system together, block by block, while they wait.
export const DexMascot = () => (
  <div className="relative w-56 h-44 mx-auto select-none" data-testid="dex-mascot">
    {/* floor */}
    <div className="absolute bottom-3 left-2 right-2 border-b-2 border-black" />

    {/* blocks Dex is stacking */}
    {[0, 1, 2].map((i) => (
      <motion.div
        key={`dex-block-${i}`}
        className={`absolute w-9 h-9 border-2 border-black ${["bg-white", "bg-brand-yellow", "bg-brand-red"][i]}`}
        style={{ right: 26, bottom: 12 + i * 34 }}
        animate={{ opacity: [0, 1, 1, 1], y: [-28, 0, 0, 0], scale: [0.5, 1, 1, 1] }}
        transition={{ repeat: Infinity, repeatDelay: 1.4, duration: 4, delay: i * 1.3, times: [0, 0.15, 0.92, 1], ease: "easeOut" }}
      />
    ))}

    {/* sparks where the hammer lands */}
    {[0, 1, 2].map((i) => (
      <motion.span
        key={`dex-spark-${i}`}
        className="absolute w-1.5 h-1.5 bg-brand-yellow border border-black"
        style={{ left: 128 + i * 11, bottom: 56 + (i % 2) * 14 }}
        animate={{ opacity: [0, 1, 0], scale: [0.5, 1.3, 0.4], y: [0, -9, -16] }}
        transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.35 }}
      />
    ))}

    {/* Dex himself */}
    <motion.div
      className="absolute left-8 bottom-3 w-24 h-32"
      animate={{ y: [0, -3, 0] }}
      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
    >
      {/* antenna */}
      <div className="absolute left-1/2 -translate-x-1/2 top-0 w-0.5 h-4 bg-black" />
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 -top-2 w-3 h-3 rounded-full bg-brand-red border border-black"
        animate={{ scale: [1, 1.35, 1], opacity: [1, 0.65, 1] }}
        transition={{ repeat: Infinity, duration: 1.2 }}
      />
      {/* head with blinking eyes */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-16 h-12 bg-white border-2 border-black flex items-center justify-center gap-2.5">
        {[0, 1].map((e) => (
          <motion.span
            key={`dex-eye-${e}`}
            className="w-2 h-2.5 bg-black rounded-sm"
            animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
            transition={{ repeat: Infinity, duration: 3.4, times: [0, 0.45, 0.5, 0.55, 1] }}
          />
        ))}
      </div>
      {/* body with spinning core */}
      <div className="absolute top-[60px] left-1/2 -translate-x-1/2 w-20 h-14 bg-brand-ink border-2 border-black flex items-center justify-center">
        <motion.div
          className="w-4 h-4 bg-brand-yellow border border-black"
          animate={{ rotate: [0, 90, 90, 180, 180, 270, 270, 360] }}
          transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
        />
      </div>
      {/* hammering arm */}
      <motion.div
        className="absolute top-[64px] -right-4 w-10 h-2 bg-black origin-left"
        animate={{ rotate: [-32, 20, -32] }}
        transition={{ repeat: Infinity, duration: 0.9, ease: "easeInOut" }}
      >
        <div className="absolute -right-1.5 -top-2.5 w-3.5 h-7 bg-brand-red border-2 border-black" />
      </motion.div>
      {/* idle arm + legs */}
      <div className="absolute top-[70px] -left-2.5 w-6 h-2 bg-black" />
      <div className="absolute bottom-0 left-5 w-2.5 h-4 bg-black" />
      <div className="absolute bottom-0 right-5 w-2.5 h-4 bg-black" />
    </motion.div>
  </div>
);
