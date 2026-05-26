const DEFAULT_CURRENCY = 'EUR';

let supportedCurrencies;

function getSupportedCurrencies() {
  if (supportedCurrencies !== undefined) {
    return supportedCurrencies;
  }

  try {
    supportedCurrencies = new Set(
      Intl.supportedValuesOf('currency').map((currency) => currency.toUpperCase())
    );
  } catch (error) {
    supportedCurrencies = null;
  }

  return supportedCurrencies;
}

export function normalizeCurrencyCode(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalized)) {
    return null;
  }

  const supported = getSupportedCurrencies();

  if (supported && !supported.has(normalized)) {
    return null;
  }

  return normalized;
}

export function getDefaultCurrency() {
  return DEFAULT_CURRENCY;
}

export function formatCurrency(value, currency = DEFAULT_CURRENCY) {
  const normalizedCurrency = normalizeCurrencyCode(currency) || DEFAULT_CURRENCY;
  const amount = Number(value || 0);

  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (error) {
    return `${normalizedCurrency} ${amount.toFixed(2)}`;
  }
}
