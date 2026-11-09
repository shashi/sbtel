// @sbtel file Sbtel.Cli.SpecCommands

package main

// Workstream A (DESIGN.md §10.A): check, query and diff. The command logic and every output format
// live in core/api.js (__api.cli); these functions only parse flags, read inputs and print.

import (
	"errors"
	"fmt"
)

var (
	errNoBindings = errors.New("--bindings <edges.txt>|- is required")
	errNoIDs      = errors.New("give at least one element id after the spec")
)

// sbtel check <spec>|- --bindings <edges.txt>|- [--json]   (DESIGN.md §3.4)
func cmdCheck(e env, args []string) int {
	f, err := parseArgs(args, []string{"json"}, []string{"bindings"})
	if err != nil {
		return usageErr(e, "check", err)
	}
	bind, ok := f.val("bindings")
	switch {
	case len(f.pos) == 0:
		return usageErr(e, "check", errNoSpec)
	case len(f.pos) > 1:
		return usageErr(e, "check", fmt.Errorf("one spec only (got %d arguments)", len(f.pos)))
	case !ok || bind == "":
		return usageErr(e, "check", errNoBindings)
	case f.pos[0] == "-" && bind == "-":
		return usageErr(e, "check", errTwoStdin)
	}
	files, code := readInputs(e, "check", []string{f.pos[0], bind})
	if code != 0 {
		return code
	}
	return runCLI(e, "check", map[string]any{"files": files[:1], "bindings": files[1], "json": f.has("json")})
}

// sbtel query <spec>|- <id>... [--with-deps] [--json]   (DESIGN.md §3.5)
func cmdQuery(e env, args []string) int {
	f, err := parseArgs(args, []string{"json", "with-deps"}, nil)
	if err != nil {
		return usageErr(e, "query", err)
	}
	if len(f.pos) == 0 {
		return usageErr(e, "query", errNoSpec)
	}
	if len(f.pos) == 1 {
		return usageErr(e, "query", errNoIDs)
	}
	files, code := readInputs(e, "query", f.pos[:1])
	if code != 0 {
		return code
	}
	return runCLI(e, "query", map[string]any{"files": files, "ids": f.pos[1:], "withDeps": f.has("with-deps"), "json": f.has("json")})
}

// sbtel diff <a> <b> [--json]   (DESIGN.md §3.6, §7.5)
func cmdDiff(e env, args []string) int {
	f, err := parseArgs(args, []string{"json"}, nil)
	if err != nil {
		return usageErr(e, "diff", err)
	}
	if len(f.pos) != 2 {
		return usageErr(e, "diff", fmt.Errorf("give exactly two specs (got %d)", len(f.pos)))
	}
	if f.pos[0] == "-" && f.pos[1] == "-" {
		return usageErr(e, "diff", errTwoStdin)
	}
	files, code := readInputs(e, "diff", f.pos)
	if code != 0 {
		return code
	}
	return runCLI(e, "diff", map[string]any{"files": files, "json": f.has("json")})
}
