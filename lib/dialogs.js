let dialogApi = null;
const waitingResolvers = new Set();

export function registerDialogApi(api) {
  dialogApi = api;

  if (dialogApi) {
    for (const resolve of waitingResolvers) {
      resolve(dialogApi);
    }
    waitingResolvers.clear();
  }
}

function getDialogApi() {
  if (dialogApi) {
    return Promise.resolve(dialogApi);
  }

  return new Promise((resolve) => {
    waitingResolvers.add(resolve);
  });
}

export async function showAlertDialog(options) {
  const api = await getDialogApi();
  return api.alert(options);
}

export async function showToast(options) {
  const api = await getDialogApi();
  return api.toast(options);
}

export async function showConfirmDialog(options) {
  const api = await getDialogApi();
  return api.confirm(options);
}

export async function showPromptDialog(options) {
  const api = await getDialogApi();
  return api.prompt(options);
}