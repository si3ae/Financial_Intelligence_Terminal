import { useState, useCallback, useEffect } from 'react';

export interface PortfolioPosition {
  id: string;
  symbol: string;
  name: string;
  buyPrice: number;
  quantity: number;
  currency: string;
  addedAt: number;
}

const STORAGE_KEY = 'terminal-portfolio';

function loadPositions(): PortfolioPosition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function usePortfolio() {
  const [positions, setPositions] = useState<PortfolioPosition[]>(loadPositions);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  }, [positions]);

  const addPosition = useCallback((pos: Omit<PortfolioPosition, 'id' | 'addedAt'>) => {
    setPositions(prev => [...prev, { ...pos, id: crypto.randomUUID(), addedAt: Date.now() }]);
  }, []);

  const removePosition = useCallback((id: string) => {
    setPositions(prev => prev.filter(p => p.id !== id));
  }, []);

  const updatePosition = useCallback((id: string, updates: Partial<Pick<PortfolioPosition, 'buyPrice' | 'quantity'>>) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  return { positions, addPosition, removePosition, updatePosition };
}
