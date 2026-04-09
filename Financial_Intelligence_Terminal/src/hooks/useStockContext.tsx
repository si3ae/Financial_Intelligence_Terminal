/**
 * useStockContext — Global stock selection state
 * Manages the currently selected stock symbol for the entire terminal
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface SelectedStock {
  symbol: string;
  name: string;
  currency: string;
  region: string;
}

interface StockContextValue {
  stock: SelectedStock;
  setStock: (s: SelectedStock) => void;
}

const defaultStock: SelectedStock = {
  symbol: '000660.KOR',
  name: 'SK hynix Inc',
  currency: 'KRW',
  region: 'Seoul',
};

const StockContext = createContext<StockContextValue>({
  stock: defaultStock,
  setStock: () => {},
});

export function StockProvider({ children }: { children: ReactNode }) {
  const [stock, setStockState] = useState<SelectedStock>(defaultStock);

  const setStock = useCallback((s: SelectedStock) => {
    setStockState(s);
  }, []);

  return (
    <StockContext.Provider value={{ stock, setStock }}>
      {children}
    </StockContext.Provider>
  );
}

export function useStock() {
  return useContext(StockContext);
}
