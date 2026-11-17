import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register as context } from "@juanibiapina/pi-session-context";
import { register as socket } from "@juanibiapina/pi-socket";
import { register as plans } from "@juanibiapina/pi-plans";
import { register as skills } from "@juanibiapina/pi-skills";
import { register as title } from "@juanibiapina/pi-title";

export default function register(pi: ExtensionAPI): void {
  context(pi);
  socket(pi);
  plans(pi);
  skills(pi);
  title(pi);
}
