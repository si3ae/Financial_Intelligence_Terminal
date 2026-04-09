import { type Locale } from './translations';

/**
 * Translated asset names for all market data tables.
 * Key = English canonical name from marketData.ts
 */

export const assetNames: Record<Locale, Record<string, string>> = {
  en: {
    // Forex
    'EUR/USD': 'EUR/USD (Euro/Dollar)', 'USD/JPY': 'USD/JPY (Dollar/Yen)', 'GBP/USD': 'GBP/USD (Pound/Dollar)',
    'USD/KRW': 'USD/KRW (Dollar/Won)', 'USD/CNY': 'USD/CNY (Dollar/Yuan)', 'EUR/GBP': 'EUR/GBP (Euro/Pound)',
    // Commodities
    'Gold': 'Gold', 'Silver': 'Silver', 'Crude Oil (WTI)': 'Crude Oil (WTI)',
    'Brent Crude': 'Brent Crude', 'Natural Gas': 'Natural Gas', 'Copper': 'Copper',
    // Bonds
    'US 2Y Treasury': 'US 2Y Treasury', 'US 10Y Treasury': 'US 10Y Treasury',
    'US 30Y Treasury': 'US 30Y Treasury', 'German 10Y Bund': 'German 10Y Bund',
    'Japan 10Y JGB': 'Japan 10Y JGB', 'UK 10Y Gilt': 'UK 10Y Gilt',
    // Crypto
    'Bitcoin': 'Bitcoin', 'Ethereum': 'Ethereum', 'Solana': 'Solana', 'XRP': 'XRP',
    // Macro
    'United States': 'United States', 'Eurozone': 'Eurozone', 'China': 'China',
    'Japan': 'Japan', 'South Korea': 'South Korea', 'United Kingdom': 'United Kingdom',
  },
  ko: {
    'EUR/USD': 'EUR/USD (유로/달러)', 'USD/JPY': 'USD/JPY (달러/엔)', 'GBP/USD': 'GBP/USD (파운드/달러)',
    'USD/KRW': 'USD/KRW (달러/원)', 'USD/CNY': 'USD/CNY (달러/위안)', 'EUR/GBP': 'EUR/GBP (유로/파운드)',
    'Gold': '금 (Gold)', 'Silver': '은 (Silver)', 'Crude Oil (WTI)': '원유 (WTI)',
    'Brent Crude': '브렌트유', 'Natural Gas': '천연가스', 'Copper': '구리',
    'US 2Y Treasury': '미국 2년 국채', 'US 10Y Treasury': '미국 10년 국채',
    'US 30Y Treasury': '미국 30년 국채', 'German 10Y Bund': '독일 10년 분트',
    'Japan 10Y JGB': '일본 10년 국채', 'UK 10Y Gilt': '영국 10년 길트',
    'Bitcoin': '비트코인', 'Ethereum': '이더리움', 'Solana': '솔라나', 'XRP': 'XRP',
    'United States': '미국', 'Eurozone': '유로존', 'China': '중국',
    'Japan': '일본', 'South Korea': '대한민국', 'United Kingdom': '영국',
  },
  zh: {
    'EUR/USD': 'EUR/USD (欧元/美元)', 'USD/JPY': 'USD/JPY (美元/日元)', 'GBP/USD': 'GBP/USD (英镑/美元)',
    'USD/KRW': 'USD/KRW (美元/韩元)', 'USD/CNY': 'USD/CNY (美元/人民币)', 'EUR/GBP': 'EUR/GBP (欧元/英镑)',
    'Gold': '黄金', 'Silver': '白银', 'Crude Oil (WTI)': '原油 (WTI)',
    'Brent Crude': '布伦特原油', 'Natural Gas': '天然气', 'Copper': '铜',
    'US 2Y Treasury': '美国2年期国债', 'US 10Y Treasury': '美国10年期国债',
    'US 30Y Treasury': '美国30年期国债', 'German 10Y Bund': '德国10年期国债',
    'Japan 10Y JGB': '日本10年期国债', 'UK 10Y Gilt': '英国10年期国债',
    'Bitcoin': '比特币', 'Ethereum': '以太坊', 'Solana': '索拉纳', 'XRP': 'XRP',
    'United States': '美国', 'Eurozone': '欧元区', 'China': '中国',
    'Japan': '日本', 'South Korea': '韩国', 'United Kingdom': '英国',
  },
  ja: {
    'EUR/USD': 'EUR/USD (ユーロ/ドル)', 'USD/JPY': 'USD/JPY (ドル/円)', 'GBP/USD': 'GBP/USD (ポンド/ドル)',
    'USD/KRW': 'USD/KRW (ドル/ウォン)', 'USD/CNY': 'USD/CNY (ドル/元)', 'EUR/GBP': 'EUR/GBP (ユーロ/ポンド)',
    'Gold': '金 (Gold)', 'Silver': '銀 (Silver)', 'Crude Oil (WTI)': '原油 (WTI)',
    'Brent Crude': 'ブレント原油', 'Natural Gas': '天然ガス', 'Copper': '銅',
    'US 2Y Treasury': '米国2年債', 'US 10Y Treasury': '米国10年債',
    'US 30Y Treasury': '米国30年債', 'German 10Y Bund': 'ドイツ10年債',
    'Japan 10Y JGB': '日本10年国債', 'UK 10Y Gilt': '英国10年債',
    'Bitcoin': 'ビットコイン', 'Ethereum': 'イーサリアム', 'Solana': 'ソラナ', 'XRP': 'XRP',
    'United States': 'アメリカ', 'Eurozone': 'ユーロ圏', 'China': '中国',
    'Japan': '日本', 'South Korea': '韓国', 'United Kingdom': 'イギリス',
  },
  gb: {
    'EUR/USD': 'EUR/USD (Euro/Dollar)', 'USD/JPY': 'USD/JPY (Dollar/Yen)', 'GBP/USD': 'GBP/USD (Pound/Dollar)',
    'USD/KRW': 'USD/KRW (Dollar/Won)', 'USD/CNY': 'USD/CNY (Dollar/Yuan)', 'EUR/GBP': 'EUR/GBP (Euro/Pound)',
    'Gold': 'Gold', 'Silver': 'Silver', 'Crude Oil (WTI)': 'Crude Oil (WTI)',
    'Brent Crude': 'Brent Crude', 'Natural Gas': 'Natural Gas', 'Copper': 'Copper',
    'US 2Y Treasury': 'US 2Y Treasury', 'US 10Y Treasury': 'US 10Y Treasury',
    'US 30Y Treasury': 'US 30Y Treasury', 'German 10Y Bund': 'German 10Y Bund',
    'Japan 10Y JGB': 'Japan 10Y JGB', 'UK 10Y Gilt': 'UK 10Y Gilt',
    'Bitcoin': 'Bitcoin', 'Ethereum': 'Ethereum', 'Solana': 'Solana', 'XRP': 'XRP',
    'United States': 'United States', 'Eurozone': 'Eurozone', 'China': 'China',
    'Japan': 'Japan', 'South Korea': 'South Korea', 'United Kingdom': 'United Kingdom',
  },
  de: {
    'EUR/USD': 'EUR/USD (Euro/Dollar)', 'USD/JPY': 'USD/JPY (Dollar/Yen)', 'GBP/USD': 'GBP/USD (Pfund/Dollar)',
    'USD/KRW': 'USD/KRW (Dollar/Won)', 'USD/CNY': 'USD/CNY (Dollar/Yuan)', 'EUR/GBP': 'EUR/GBP (Euro/Pfund)',
    'Gold': 'Gold', 'Silver': 'Silber', 'Crude Oil (WTI)': 'Rohöl (WTI)',
    'Brent Crude': 'Brent-Rohöl', 'Natural Gas': 'Erdgas', 'Copper': 'Kupfer',
    'US 2Y Treasury': 'US 2J Staatsanleihe', 'US 10Y Treasury': 'US 10J Staatsanleihe',
    'US 30Y Treasury': 'US 30J Staatsanleihe', 'German 10Y Bund': 'Dt. 10J Bundesanleihe',
    'Japan 10Y JGB': 'Japan 10J Staatsanleihe', 'UK 10Y Gilt': 'UK 10J Gilt',
    'Bitcoin': 'Bitcoin', 'Ethereum': 'Ethereum', 'Solana': 'Solana', 'XRP': 'XRP',
    'United States': 'Vereinigte Staaten', 'Eurozone': 'Eurozone', 'China': 'China',
    'Japan': 'Japan', 'South Korea': 'Südkorea', 'United Kingdom': 'Vereinigtes Königreich',
  },
  fr: {
    'EUR/USD': 'EUR/USD (Euro/Dollar)', 'USD/JPY': 'USD/JPY (Dollar/Yen)', 'GBP/USD': 'GBP/USD (Livre/Dollar)',
    'USD/KRW': 'USD/KRW (Dollar/Won)', 'USD/CNY': 'USD/CNY (Dollar/Yuan)', 'EUR/GBP': 'EUR/GBP (Euro/Livre)',
    'Gold': 'Or', 'Silver': 'Argent', 'Crude Oil (WTI)': 'Pétrole brut (WTI)',
    'Brent Crude': 'Brent', 'Natural Gas': 'Gaz naturel', 'Copper': 'Cuivre',
    'US 2Y Treasury': 'US 2A Trésor', 'US 10Y Treasury': 'US 10A Trésor',
    'US 30Y Treasury': 'US 30A Trésor', 'German 10Y Bund': 'Bund allemand 10A',
    'Japan 10Y JGB': 'JGB Japon 10A', 'UK 10Y Gilt': 'Gilt UK 10A',
    'Bitcoin': 'Bitcoin', 'Ethereum': 'Ethereum', 'Solana': 'Solana', 'XRP': 'XRP',
    'United States': 'États-Unis', 'Eurozone': 'Zone euro', 'China': 'Chine',
    'Japan': 'Japon', 'South Korea': 'Corée du Sud', 'United Kingdom': 'Royaume-Uni',
  },
  it: {
    'EUR/USD': 'EUR/USD (Euro/Dollaro)', 'USD/JPY': 'USD/JPY (Dollaro/Yen)', 'GBP/USD': 'GBP/USD (Sterlina/Dollaro)',
    'USD/KRW': 'USD/KRW (Dollaro/Won)', 'USD/CNY': 'USD/CNY (Dollaro/Yuan)', 'EUR/GBP': 'EUR/GBP (Euro/Sterlina)',
    'Gold': 'Oro', 'Silver': 'Argento', 'Crude Oil (WTI)': 'Greggio (WTI)',
    'Brent Crude': 'Brent', 'Natural Gas': 'Gas naturale', 'Copper': 'Rame',
    'US 2Y Treasury': 'US 2A Treasury', 'US 10Y Treasury': 'US 10A Treasury',
    'US 30Y Treasury': 'US 30A Treasury', 'German 10Y Bund': 'Bund tedesco 10A',
    'Japan 10Y JGB': 'JGB Giappone 10A', 'UK 10Y Gilt': 'Gilt UK 10A',
    'Bitcoin': 'Bitcoin', 'Ethereum': 'Ethereum', 'Solana': 'Solana', 'XRP': 'XRP',
    'United States': 'Stati Uniti', 'Eurozone': 'Eurozona', 'China': 'Cina',
    'Japan': 'Giappone', 'South Korea': 'Corea del Sud', 'United Kingdom': 'Regno Unito',
  },
};

/** Helper hook-friendly lookup */
export const translateAsset = (locale: Locale, name: string): string =>
  assetNames[locale]?.[name] ?? name;
