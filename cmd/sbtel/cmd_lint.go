// @sbtel file Sbtel.Cli.SpecCommands

package main

// sbtel lint <spec>|- ... [--json]   (DESIGN.md §3.3). Foundation: frozen.
func cmdLint(e env, args []string) int {
	f, err := parseArgs(args, []string{"json"}, nil)
	if err != nil {
		return usageErr(e, "lint", err)
	}
	if len(f.pos) == 0 {
		return usageErr(e, "lint", errNoSpec)
	}
	files, code := readInputs(e, "lint", f.pos)
	if code != 0 {
		return code
	}
	return runCLI(e, "lint", map[string]any{"files": files, "json": f.has("json")})
}
