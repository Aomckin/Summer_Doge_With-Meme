import { MemeVaultApp } from "./app";
import {
  capabilitiesFor,
  getCurrentAuth,
  logout,
  mountRoleControls,
  renderAccessGate,
  renderAuthLoading,
  type AuthState,
} from "./auth";
import "./styles/tokens.css";
import "./styles/main.css";
import "./styles/appearance.css";
import "./styles/shell.css";
import "./styles/library.css";
import "./styles/inspector-dialog.css";
import "./styles/states.css";
import "./styles/immersive.css";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Meme Vault root element is missing");
}

let renderingGate = false;

function showGate(message = ""): void {
  if (renderingGate) return;
  renderingGate = true;
  document.documentElement.removeAttribute("data-auth-role");
  renderAccessGate(root!, state => {
    renderingGate = false;
    void startVault(state);
  }, message);
}

async function startVault(state: AuthState): Promise<void> {
  if (!state.authenticated || !state.role) {
    showGate();
    return;
  }
  const role = state.role;
  document.documentElement.dataset.authRole = role;
  const application = new MemeVaultApp(root!, undefined, capabilitiesFor(role));
  mountRoleControls(root!, role, () => {
    void logout().finally(() => showGate());
  });
  await application.start();
}

window.addEventListener("meme-vault:unauthorized", () => showGate("Session 已失效，请重新输入 Access Key。"));
renderAuthLoading(root);
void getCurrentAuth()
  .then(startVault)
  .catch(() => showGate("暂时无法确认访问身份。"));
