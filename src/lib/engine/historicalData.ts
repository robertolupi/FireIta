/**
 * Serie storiche annuali per backtesting (Historical Rolling / Block Bootstrap).
 *
 * Fonti (consultate ottobre 2026):
 * - USA equity/bond: tabella "Historical Returns on Stocks, Bonds and Bills" di A. Damodaran (NYU Stern),
 *   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html
 *   S&P 500 total return (dividendi reinvestiti) e US Treasury 10y total return, 1928-2024.
 *   Cross-check equity vs Slickcharts S&P 500 Total Returns (https://www.slickcharts.com/sp500/returns):
 *   scostamenti tipici <=0,5pp/anno (maggiori negli anni '30, es. 1933: 49,98% vs 53,99%) per metodologie
 *   di ricostruzione diverse; si usa Damodaran come unica fonte coerente per equity+bond.
 * - USA inflazione: variazione annua del CPI medio annuo (BLS), tabella "U.S. Inflation Rate by Year",
 *   https://www.usinflationcalculator.com/inflation/historical-inflation-rates/ (colonna "Ave").
 * - Italia inflazione: variazione media annua ISTAT NIC/FOI.
 *   1956-2024: calcolata dalla serie FRED/OECD ITACPIALLAINMEI (CPI Italia, media annua, base ISTAT),
 *   coerente con rivaluta.it; 1955: rivaluta.it; 1950-1954: ISTAT "Sommario di statistiche storiche
 *   1861-2010" (cap. 21, ricostruzione storica — per il 1951 la fonte ufficiale dà +9,7%, altre
 *   compilazioni +14,3%).
 *
 * LIMITAZIONE PROXY (dataset Italia): serie lunghe affidabili di rendimenti azionari/obbligazionari
 * italiani non sono disponibili; equityReturn e bondReturn del dataset Italia sono IDENTICI a quelli
 * USA per gli anni sovrapposti. Lo scopo del dataset Italia è usare l'inflazione italiana (ISTAT).
 */
import type { HistoricalDatasetId, HistoricalYearData } from './types'

const row = (calendarYear: number, equityReturn: number, bondReturn: number, inflationRate: number): HistoricalYearData => ({
  calendarYear,
  equityReturn,
  bondReturn,
  inflationRate
})

// USA 1928-2024: S&P 500 TR / T.Bond 10y TR (Damodaran), CPI medio annuo YoY (BLS)
export const HISTORICAL_DATA_USA: HistoricalYearData[] = [
  row(1928, 0.4381, 0.0084, -0.017),
  row(1929, -0.083, 0.042, 0),
  row(1930, -0.2512, 0.0454, -0.023),
  row(1931, -0.4384, -0.0256, -0.09),
  row(1932, -0.0864, 0.0879, -0.099),
  row(1933, 0.4998, 0.0186, -0.051),
  row(1934, -0.0119, 0.0796, 0.031),
  row(1935, 0.4674, 0.0447, 0.022),
  row(1936, 0.3194, 0.0502, 0.015),
  row(1937, -0.3534, 0.0138, 0.036),
  row(1938, 0.2928, 0.0421, -0.021),
  row(1939, -0.011, 0.0441, -0.014),
  row(1940, -0.1067, 0.054, 0.007),
  row(1941, -0.1277, -0.0202, 0.05),
  row(1942, 0.1917, 0.0229, 0.109),
  row(1943, 0.2506, 0.0249, 0.061),
  row(1944, 0.1903, 0.0258, 0.017),
  row(1945, 0.3582, 0.038, 0.023),
  row(1946, -0.0843, 0.0313, 0.083),
  row(1947, 0.052, 0.0092, 0.144),
  row(1948, 0.057, 0.0195, 0.081),
  row(1949, 0.183, 0.0466, -0.012),
  row(1950, 0.3081, 0.0043, 0.013),
  row(1951, 0.2368, -0.003, 0.079),
  row(1952, 0.1815, 0.0227, 0.019),
  row(1953, -0.0121, 0.0414, 0.008),
  row(1954, 0.5256, 0.0329, 0.007),
  row(1955, 0.326, -0.0134, -0.004),
  row(1956, 0.0744, -0.0226, 0.015),
  row(1957, -0.1046, 0.068, 0.033),
  row(1958, 0.4372, -0.021, 0.028),
  row(1959, 0.1206, -0.0265, 0.007),
  row(1960, 0.0034, 0.1164, 0.017),
  row(1961, 0.2664, 0.0206, 0.01),
  row(1962, -0.0881, 0.0569, 0.01),
  row(1963, 0.2261, 0.0168, 0.013),
  row(1964, 0.1642, 0.0373, 0.013),
  row(1965, 0.124, 0.0072, 0.016),
  row(1966, -0.0997, 0.0291, 0.029),
  row(1967, 0.238, -0.0158, 0.031),
  row(1968, 0.1081, 0.0327, 0.042),
  row(1969, -0.0824, -0.0501, 0.055),
  row(1970, 0.0356, 0.1675, 0.057),
  row(1971, 0.1422, 0.0979, 0.044),
  row(1972, 0.1876, 0.0282, 0.032),
  row(1973, -0.1431, 0.0366, 0.062),
  row(1974, -0.259, 0.0199, 0.11),
  row(1975, 0.37, 0.0361, 0.091),
  row(1976, 0.2383, 0.1598, 0.058),
  row(1977, -0.0698, 0.0129, 0.065),
  row(1978, 0.0651, -0.0078, 0.076),
  row(1979, 0.1852, 0.0067, 0.113),
  row(1980, 0.3174, -0.0299, 0.135),
  row(1981, -0.047, 0.082, 0.103),
  row(1982, 0.2042, 0.3281, 0.062),
  row(1983, 0.2234, 0.032, 0.032),
  row(1984, 0.0615, 0.1373, 0.043),
  row(1985, 0.3124, 0.2571, 0.036),
  row(1986, 0.1849, 0.2428, 0.019),
  row(1987, 0.0581, -0.0496, 0.036),
  row(1988, 0.1654, 0.0822, 0.041),
  row(1989, 0.3148, 0.1769, 0.048),
  row(1990, -0.0306, 0.0624, 0.054),
  row(1991, 0.3023, 0.15, 0.042),
  row(1992, 0.0749, 0.0936, 0.03),
  row(1993, 0.0997, 0.1421, 0.03),
  row(1994, 0.0133, -0.0804, 0.026),
  row(1995, 0.372, 0.2348, 0.028),
  row(1996, 0.2268, 0.0143, 0.03),
  row(1997, 0.331, 0.0994, 0.023),
  row(1998, 0.2834, 0.1492, 0.016),
  row(1999, 0.2089, -0.0825, 0.022),
  row(2000, -0.0903, 0.1666, 0.034),
  row(2001, -0.1185, 0.0557, 0.028),
  row(2002, -0.2197, 0.1512, 0.016),
  row(2003, 0.2836, 0.0038, 0.023),
  row(2004, 0.1074, 0.0449, 0.027),
  row(2005, 0.0483, 0.0287, 0.034),
  row(2006, 0.1561, 0.0196, 0.032),
  row(2007, 0.0548, 0.1021, 0.028),
  row(2008, -0.3655, 0.201, 0.038),
  row(2009, 0.2594, -0.1112, -0.004),
  row(2010, 0.1482, 0.0846, 0.016),
  row(2011, 0.021, 0.1604, 0.032),
  row(2012, 0.1589, 0.0297, 0.021),
  row(2013, 0.3215, -0.091, 0.015),
  row(2014, 0.1352, 0.1075, 0.016),
  row(2015, 0.0138, 0.0128, 0.001),
  row(2016, 0.1177, 0.0069, 0.013),
  row(2017, 0.2161, 0.028, 0.021),
  row(2018, -0.0423, -0.0002, 0.024),
  row(2019, 0.3121, 0.0964, 0.018),
  row(2020, 0.1802, 0.1133, 0.012),
  row(2021, 0.2847, -0.0442, 0.047),
  row(2022, -0.1804, -0.1783, 0.08),
  row(2023, 0.2606, 0.0388, 0.041),
  row(2024, 0.2488, -0.0164, 0.029)
]

/**
 * Inflazione italiana (variazione media annua ISTAT NIC/FOI).
 * 1950-1954: ISTAT Sommario di statistiche storiche 1861-2010.
 * 1955: rivaluta.it (da indici ISTAT). 1956-2024: calcolata da FRED/OECD ITACPIALLAINMEI.
 * Nota: gli analoghi valori "ufficiali" pubblicati da ISTAT per singoli anni possono differire
 * di +-0,2pp per vintage/serie (es. 2022: 8,1% NIC comunicato vs 8,2% da medie indice; 2024: 0,8% vs 1,0%).
 */
const ITALIAN_INFLATION: Record<number, number> = {
  1950: -0.013,
  1951: 0.097,
  1952: 0.042,
  1953: 0.019,
  1954: 0.027,
  1955: 0.023,
  1956: 0.03383,
  1957: 0.01318,
  1958: 0.02859,
  1959: -0.00507,
  1960: 0.0235,
  1961: 0.02051,
  1962: 0.04691,
  1963: 0.07455,
  1964: 0.05912,
  1965: 0.04519,
  1966: 0.02347,
  1967: 0.03733,
  1968: 0.01277,
  1969: 0.02657,
  1970: 0.04968,
  1971: 0.04792,
  1972: 0.0575,
  1973: 0.10799,
  1974: 0.1916,
  1975: 0.1695,
  1976: 0.16614,
  1977: 0.1713,
  1978: 0.12094,
  1979: 0.14799,
  1980: 0.21064,
  1981: 0.17969,
  1982: 0.1648,
  1983: 0.14647,
  1984: 0.10794,
  1985: 0.09206,
  1986: 0.05824,
  1987: 0.04747,
  1988: 0.05058,
  1989: 0.0626,
  1990: 0.06457,
  1991: 0.0625,
  1992: 0.05271,
  1993: 0.04627,
  1994: 0.04052,
  1995: 0.05235,
  1996: 0.04007,
  1997: 0.02043,
  1998: 0.01955,
  1999: 0.01663,
  2000: 0.02538,
  2001: 0.02785,
  2002: 0.02465,
  2003: 0.02673,
  2004: 0.02207,
  2005: 0.01985,
  2006: 0.02091,
  2007: 0.0183,
  2008: 0.03348,
  2009: 0.00775,
  2010: 0.01526,
  2011: 0.02781,
  2012: 0.03041,
  2013: 0.0122,
  2014: 0.00241,
  2015: 0.00039,
  2016: -0.00094,
  2017: 0.01227,
  2018: 0.01137,
  2019: 0.00611,
  2020: -0.00138,
  2021: 0.01874,
  2022: 0.08201,
  2023: 0.05622,
  2024: 0.00982
}

// Italia 1950-2024: equity/bond copiati dal dataset USA (proxy documentata sopra), inflazione ISTAT
export const HISTORICAL_DATA_ITALIA: HistoricalYearData[] = HISTORICAL_DATA_USA.filter(
  r => r.calendarYear >= 1950
).map(r => ({ ...r, inflationRate: ITALIAN_INFLATION[r.calendarYear] }))

export const HISTORICAL_DATASETS: Record<HistoricalDatasetId, HistoricalYearData[]> = {
  usa: HISTORICAL_DATA_USA,
  italia: HISTORICAL_DATA_ITALIA
}

export const HISTORICAL_DATASET_LABELS: Record<HistoricalDatasetId, string> = {
  usa: 'USA 1928–2024 (S&P 500 / Treasury / CPI)',
  italia: 'Italia 1950–2024 (infl. ISTAT)'
}

/** Rendimento annuo di portafoglio azioni/obbligazioni; stockAllocation è clappato in [0,1] */
export function computeHistoricalPortfolioReturn(row: HistoricalYearData, stockAllocation: number): number {
  const wEq = Math.min(1, Math.max(0, stockAllocation))
  return wEq * row.equityReturn + (1 - wEq) * row.bondReturn
}
