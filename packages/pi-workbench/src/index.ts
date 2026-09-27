import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register as context } from "@juanibiapina/pi-session-context";
import { register as tmux } from "@juanibiapina/pi-tmux";
import { register as socket } from "@juanibiapina/pi-socket";
import { register as plans } from "@juanibiapina/pi-plans";
import { register as github } from "@juanibiapina/pi-github";
import { register as skills } from "@juanibiapina/pi-skills";

export default function register(pi: ExtensionAPI): void {
  context(pi);
  tmux(pi);
  socket(pi);
  plans(pi);
  github(pi);
  skills(pi);
}
