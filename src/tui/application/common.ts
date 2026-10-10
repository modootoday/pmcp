import { invoke } from "../../harness/application/invoke.js";
import { GroupStore } from "../../harness/groups/store.js";
import type { Operation, Receipt } from "../../harness/contracts.js";
import type { View, Snapshot } from "../contracts.js";

export class CommonHarness {
  constructor(
    readonly view: Pick<View, "groupFile" | "generation" | "groupOwner">,
  ) {}

  async call(
    family: string,
    action: string,
    input: Partial<Operation> = {},
  ): Promise<Receipt> {
    const group = new GroupStore(this.view.groupFile).state.group;
    if (group.owner !== this.view.groupOwner) throw new Error("foreign_group");
    if (group.generation !== this.view.generation)
      throw new Error("stale_group_generation");
    const receipt = await invoke({
      ...input,
      family,
      action,
      groupFile: this.view.groupFile,
      generation: this.view.generation,
    });
    if (receipt.ok !== true)
      throw new Error(String(receipt.error ?? "operation_failed"));
    return receipt;
  }

  async snapshot(): Promise<Snapshot> {
    const group = await this.call("group", "inspect");
    const sessions = await this.call("session", "list");
    const deliveries = await this.call("delivery", "list");
    const recovery = await this.call("recovery", "inspect");
    return {
      group: group.group,
      sessions: sessions.sessions,
      deliveries: deliveries.deliveries,
      control: recovery.control,
    } as Snapshot;
  }
}
