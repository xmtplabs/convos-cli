import { Help } from "@oclif/core";

export default class ConvosHelp extends Help {
  async showRootHelp(): Promise<void> {
    await super.showRootHelp();

    this.log(
      this.section(
        "GETTING STARTED",
        this.wrap(
          [
            "Initialize your Convos configuration:",
            "",
            "  $ convos init",
            "",
            "Create a conversation (auto-creates a per-conversation identity):",
            "",
            "  $ convos conversations create --name 'My Group'",
            "",
            "Send a message:",
            "",
            "  $ convos conversation send-text <conversation-id> 'Hello!'",
            "",
            "List all conversations across all identities:",
            "",
            "  $ convos conversations list",
            "",
            "CONVOS PRIVACY MODEL",
            "",
            "  Convos creates a unique XMTP identity (inbox) for each conversation.",
            "  Conversations cannot be linked or correlated by external observers.",
            "",
            "  All standard XMTP commands are also available (from @xmtp/cli plugin).",
            "  Run 'convos <command> --help' for more information on a command.",
          ].join("\n"),
        ),
      ),
    );
    this.log("");
  }
}
