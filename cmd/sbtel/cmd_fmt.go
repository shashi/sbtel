// @sbtel file Sbtel.Cli.SpecCommands

package main

// sbtel fmt --migrate-ports [--check] <spec>|- ...   (DESIGN.md §3.15, v0.3.0)
// Rewrites the 0.2 port form, (port name in Type), as 0.3's, (port :in Type :as name), in place. The
// rewrite itself is __api.migratePorts (core/api.js); this only reads, writes and reports.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/shashi/sbtel/internal/engine"
)

var errNoRewrite = errors.New("say which rewrite: --migrate-ports (the only one so far)")

type migration struct {
	Error *struct {
		Message string `json:"message"`
		Line    int    `json:"line"`
		Col     int    `json:"col"`
	} `json:"error"`
	Src   string `json:"src"`
	Ports []struct {
		Line int    `json:"line"`
		Col  int    `json:"col"`
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"ports"`
}

func cmdFmt(e env, args []string) int {
	f, err := parseArgs(args, []string{"migrate-ports", "check"}, nil)
	if err != nil {
		return usageErr(e, "fmt", err)
	}
	if !f.has("migrate-ports") {
		return usageErr(e, "fmt", errNoRewrite)
	}
	if len(f.pos) == 0 {
		return usageErr(e, "fmt", errNoSpec)
	}
	files, code := readInputs(e, "fmt", f.pos)
	if code != 0 {
		return code
	}
	en, err := engine.New()
	if err != nil {
		fmt.Fprintf(e.stderr, "sbtel fmt: %v\n", err)
		return 2
	}
	exit := 0
	for _, file := range files {
		out, err := en.Call("migratePorts", file.Src)
		var m migration
		if err == nil {
			err = json.Unmarshal([]byte(out), &m)
		}
		if err != nil {
			fmt.Fprintf(e.stderr, "sbtel fmt: %s: %v\n", file.Name, err)
			return 2
		}
		if m.Error != nil {
			fmt.Fprintf(e.stderr, "%s:%d:%d: error: %s\n", file.Name, m.Error.Line, m.Error.Col, m.Error.Message)
			exit = 2
			continue
		}
		stdin := file.Name == "<stdin>"
		report := e.stdout
		if stdin && !f.has("check") {
			report = e.stderr // stdout carries the spec
		}
		for _, p := range m.Ports {
			fmt.Fprintf(report, "%s:%d:%d: %s -> %s\n", file.Name, p.Line, p.Col, p.From, p.To)
		}
		n := len(m.Ports)
		switch {
		case f.has("check"):
			fmt.Fprintf(report, "%s: %s in the 0.2 form\n", file.Name, portCount(n))
			if n > 0 && exit == 0 {
				exit = 1
			}
		case stdin:
			fmt.Fprint(e.stdout, m.Src)
			fmt.Fprintf(report, "%s: rewrote %s\n", file.Name, portCount(n))
		default:
			if n > 0 {
				mode := os.FileMode(0o644)
				if info, err := os.Stat(file.Name); err == nil {
					mode = info.Mode().Perm()
				}
				if err := os.WriteFile(file.Name, []byte(m.Src), mode); err != nil {
					fmt.Fprintf(e.stderr, "sbtel fmt: %v\n", err)
					return 2
				}
			}
			fmt.Fprintf(report, "%s: rewrote %s\n", file.Name, portCount(n))
		}
	}
	return exit
}

// portCount is "1 port" or "N ports" (cmd_fmt.go keeps its own, rather than borrow cmd_b.go's plural).
func portCount(n int) string {
	if n == 1 {
		return "1 port"
	}
	return fmt.Sprintf("%d ports", n)
}
