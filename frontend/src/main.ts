import { MemeVaultApp } from "./app";
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

const application = new MemeVaultApp(root);
void application.start();
