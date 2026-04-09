/**
 * MotionGlass — Reusable framer-motion glass hover wrapper
 * Applies spring-based scale + glass transparency on hover
 */
import { motion } from 'framer-motion';
import { type ReactNode } from 'react';

interface MotionGlassProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'button' | 'a';
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
}

const fastTransition = { duration: 0.15, ease: 'easeOut' as const };

const MotionGlass = ({ children, className = '', as = 'div', ...props }: MotionGlassProps) => {
  const Component = as === 'a' ? motion.a : as === 'button' ? motion.button : motion.div;

  return (
    <Component
      className={className}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      transition={fastTransition}
      {...props}
    >
      {children}
    </Component>
  );
};

export default MotionGlass;
