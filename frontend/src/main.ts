import { MemeVaultApp } from "./app";
import "./styles/main.css";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Meme Vault root element is missing");
}

const application = new MemeVaultApp(root);
void application.start();
