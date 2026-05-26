const DEFAULT_CURRENCY = 'EUR';

function getSupportedCurrencyCodes() {
  try {
    return Intl.supportedValuesOf('currency');
  } catch (error) {
    return ['EUR', 'USD', 'GBP', 'INR', 'AUD', 'CAD', 'JPY', 'CHF', 'CNY', 'SGD'];
  }
}

function getCurrencyDisplayName(code) {
  try {
    const displayNames = new Intl.DisplayNames(undefined, { type: 'currency' });
    return displayNames.of(code);
  } catch (error) {
    return code;
  }
}

export const CURRENCY_OPTIONS = getSupportedCurrencyCodes()
  .map((currencyCode) => currencyCode.toUpperCase())
  .sort((left, right) => left.localeCompare(right))
  .map((currencyCode) => ({
    value: currencyCode,
    label: `${currencyCode} - ${getCurrencyDisplayName(currencyCode)}`
  }));

export function formatCurrency(value, currency = DEFAULT_CURRENCY) {
  const amount = Number(value || 0);
  const currencyCode = String(currency || DEFAULT_CURRENCY).toUpperCase();

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (error) {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}
