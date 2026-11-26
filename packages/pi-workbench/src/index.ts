import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register as title } from "@juanibiapina/pi-title";

export default function register(pi: ExtensionAPI): void {
  title(pi);
}
