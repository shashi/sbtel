// @sbtel file Sbtel.Cli.Dispatch

// Command sbtel: the sbtel CLI. docs/DESIGN.md §3 is the contract for every command.
// Exit codes: 0 ok, 1 check failures, 2 usage or IO error.
//
// File ownership (DESIGN.md §10): this file, args.go and cmd_lint.go are frozen foundation; each
// workstream replaces only its own cmd_*.go stubs. Adding a command means one line in `commands`.
package main

import (
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/shashi/sbtel"
)

// @sbtel Sbtel.Cli.Kit
// (env is the vocabulary every command and args.go are written in; it sits here because main.go is
// the frozen foundation file. Its owner follows its callers, not the check: annotations.md.)
// env is what a command may touch; tests substitute buffers.
type env struct {
	stdin          io.Reader
	stdout, stderr io.Writer
}

type command struct {
	run    func(e env, args []string) int
	usage  string // one line, shown in `sbtel help`
	help   string // what `sbtel <command> --help` prints after the usage line
	hidden bool
}

// commands is filled in init (a literal here would be an initialization cycle: commands use usageErr).
var commands map[string]command

func init() {
	commands = map[string]command{
		"version": {run: cmdVersion, usage: "version                                  print the version",
			help: "Print the version, as `sbtel <version>`."},
		"licenses": {run: cmdLicenses, usage: "licenses                                 sbtel's license and the third-party notices",
			help: "Print sbtel's license (MIT) and the licenses of the third-party code in the binary\n(THIRD_PARTY_NOTICES)."},
		"lint": {run: cmdLint, usage: "lint <spec>|- ... [--json]               parse errors, warnings and spec rules",
			help: "Parse each spec and run the spec rules. Prints warnings and failures, then one summary line per\nfile. - reads a spec from stdin.\n\n  --json   one LintResult per file, as JSON Lines\n\nExit 1 if any file has problems."},
		"check": {run: cmdCheck, usage: "check <spec>|- --bindings <edges.txt>|- [--json]  code bindings the levels forbid",
			help: "Check code bindings (one `Caller -> Callee  # location` edge per line) against the spec's levels.\nPrints every binding the levels does not allow, then a summary. Either the spec or the bindings\nmay be -.\n\n  --bindings f   the edges file (required)\n  --json         one CheckResult, as JSON\n\nExit 1 on a violation or a spec parse error, 2 on a line that is not an edge."},
		"query": {run: cmdQuery, usage: "query <spec>|- <id>... [--with-deps] [--json]  print elements of a spec",
			help: "Print the elements with the given ids (block names, β:Behavior, μ:Message) as a fragment that lints\nclean on its own, headed by comments that say where each one is.\n\n  --with-deps   also the blocks they may bind to, collapsed\n  --json        one QueryResult, as JSON\n\nExit 2 if an id names nothing."},
		"diff": {run: cmdDiff, usage: "diff <a> <b> [--json]                    what changed between two specs",
			help: "Print what changed between two specs: added, removed, moved, renamed and changed elements, and the\naffected ports. One side may be -.\n\n  --json   the diff as JSON\n\nExit 0 if nothing changed, 1 if the specs differ."},
		"open": {run: cmdOpen, usage: "open <spec>|- [--session id] [--label t] [--bindings f] [--no-browser] [--json]",
			help: "Open the spec's diagram in the browser through the local server, and print the session id. The\nhuman's comments and saves arrive in `sbtel inbox`. - reads the spec from stdin.\n\n  --session id    push this spec as the next version of an open session (the tab offers Reload)\n  --label t       the name shown in the tab (default: the file name)\n  --bindings f    an edges file whose violations the tab shows (as for sbtel check)\n  --no-browser    only print the URL (also SBTEL_NO_BROWSER=1)\n  --json          {session, url, version, created}"},
		"open-diff": {run: cmdOpenDiff, usage: "open-diff <a> <b> [--session id] [--label t] [--no-browser] [--json]",
			help: "Open a visual diff of a and b in the browser, and print the session id. One side may be -.\n\n  --session id    push a new pair to an open diff session\n  --label t       the name shown in the tab (default: \"a → b\")\n  --no-browser    only print the URL (also SBTEL_NO_BROWSER=1)\n  --json          {session, url, version, created}"},
		"inbox": {run: cmdInbox, usage: "inbox <session> [--wait] [--timeout s] [--peek] [--json]",
			help: "Print what the human sent in a session (reviews, comments sent on their own, saves), and mark it read.\nA review prints as one unit: its message, the diff of its proposed spec, the spec's path, then its\ncomments. Nothing pending in the human's draft is ever shown, and --wait does not wake for it.\n\n  --wait        wait until something arrives\n  --timeout s   give up waiting after s seconds (default 600; 0 waits forever)\n  --peek        do not mark anything read\n  --json        one event per line"},
		"reply": {run: cmdReply, usage: "reply <session> <comment-id> <text>|-",
			help: "Answer a comment (its id, such as c2 or c7.1 for a review's first comment, is in `sbtel inbox`), or a\nreview as a whole (r7); the open tab shows the reply at once.\n- reads the text from stdin."},
		"sessions": {run: cmdSessions, usage: "sessions [--json]                        list sessions",
			help: "List the sessions, newest first: id, kind, label, version, unread events, last update and path.\n\n  --json   one object per session"},
		"close": {run: cmdClose, usage: "close <session>                          end a session",
			help: "End a session: its tabs say so and its state is deleted. A spec file is never touched."},
		"serve": {run: cmdServe, usage: "serve --status|--stop [--json]           the local viewer server",
			help: "The shared localhost server that open and open-diff start.\n\n  --status   say whether it runs (exit 0) or not (exit 1)\n  --stop     stop it\n  --json     --status as JSON"},
	}
}

func main() { os.Exit(run(os.Args[1:], env{os.Stdin, os.Stdout, os.Stderr})) }

func run(args []string, e env) int {
	if len(args) == 0 {
		fmt.Fprint(e.stderr, usageText())
		return 2
	}
	switch args[0] {
	case "help", "-h", "--help":
		if len(args) > 1 {
			if c, ok := commands[args[1]]; ok && !c.hidden {
				fmt.Fprint(e.stdout, commandHelp(args[1]))
				return 0
			}
			fmt.Fprintf(e.stderr, "sbtel help: unknown command %q (try sbtel help)\n", args[1])
			return 2
		}
		fmt.Fprint(e.stdout, usageText())
		return 0
	case "--version":
		return cmdVersion(e, nil)
	}
	c, ok := commands[args[0]]
	if !ok {
		fmt.Fprintf(e.stderr, "sbtel: unknown command %q (try sbtel help)\n", args[0])
		return 2
	}
	if wantsHelp(args[1:]) {
		fmt.Fprint(e.stdout, commandHelp(args[0]))
		return 0
	}
	return c.run(e, args[1:])
}

// wantsHelp reports whether --help or -h comes before any "--" in a command's arguments. No command
// takes either as a value (parseArgs would reject them as unknown flags), so this never hides one.
func wantsHelp(args []string) bool {
	for _, a := range args {
		if a == "--" {
			return false
		}
		if a == "--help" || a == "-h" {
			return true
		}
	}
	return false
}

// commandHelp is what `sbtel <command> --help` and `sbtel help <command>` print.
func commandHelp(name string) string {
	c := commands[name]
	syntax, _, _ := strings.Cut(c.usage, "  ") // the usage line without its trailing summary
	h := "usage: sbtel " + strings.TrimSpace(syntax) + "\n"
	if c.help != "" {
		h += "\n" + c.help + "\n"
	}
	return h
}

func usageText() string {
	var b strings.Builder
	b.WriteString("sbtel: a language to design, understand, and collaborate on a system's architecture with AI.\n\nusage: sbtel <command> [args]\n\n")
	names := make([]string, 0, len(commands))
	for n, c := range commands {
		if !c.hidden {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	for _, n := range names {
		b.WriteString("  sbtel " + commands[n].usage + "\n")
	}
	b.WriteString("\n`sbtel <command> --help` describes a command and its flags.\nExit codes: 0 ok, 1 check failures, 2 usage or IO error. Contract: docs/DESIGN.md.\n")
	return b.String()
}

func cmdVersion(e env, args []string) int {
	if len(args) > 0 {
		fmt.Fprintln(e.stderr, "usage: sbtel version")
		return 2
	}
	fmt.Fprintf(e.stdout, "sbtel %s\n", sbtel.Version())
	return 0
}

// cmdLicenses prints sbtel's license, then the notices of the third-party code in the binary.
func cmdLicenses(e env, args []string) int {
	if len(args) > 0 {
		fmt.Fprintln(e.stderr, "usage: sbtel licenses")
		return 2
	}
	fmt.Fprintf(e.stdout, "sbtel %s is under the MIT license:\n\n%s\n", sbtel.Version(), strings.TrimRight(sbtel.License, "\n"))
	fmt.Fprintf(e.stdout, "\n%s", sbtel.ThirdPartyNotices)
	return 0
}
