import { uploadMeme } from "./api";
import { MobileIngestController } from "./mobile-ingest";
import "./styles/mobile-ingest.css";

const root = document.querySelector<HTMLElement>("#mobile-ingest");
if (!root) {
  throw new Error("Mobile Ingest root is missing");
}

new MobileIngestController(root, { uploadMeme });
