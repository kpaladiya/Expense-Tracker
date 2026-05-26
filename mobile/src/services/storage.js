import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'shared-expenses-token';

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveToken(token) {
  if (!token) {
    await clearToken();
    return;
  }

  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
