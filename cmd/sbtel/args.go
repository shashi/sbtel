// @sbtel file Sbtel.Cli.Kit

package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/shashi/sbtel/internal/engine"
)

// flags is the result of parseArgs.
type flags struct {
	pos   []string          // positional arguments, in order ("-" is positional)
	bools map[string]bool   // boolean flags that were given
	vals  map[string]string // valued flags that were given (last one wins)
}

func (f flags) has(name string) bool { return f.bools[name] }
func (f flags) val(name string) (string, bool) {
	v, ok := f.vals[name]
	return v, ok
}

// parseArgs is the one flag syntax every command uses (DESIGN.md §3.1): flags and positionals
// mix in any order; long flags only: --name, --name=value or --name value; "--" ends flags; "-"
// is a positional (stdin). boolNames take no value, valueNames require one. Anything else
// starting with "-" is a usage error.
func parseArgs(args []string, boolNames, valueNames []string) (flags, error) {
	f := flags{bools: map[string]bool{}, vals: map[string]string{}}
	isBool, isVal := map[string]bool{}, map[string]bool{}
	for _, n := range boolNames {
		isBool[n] = true
	}
	for _, n := range valueNames {
		isVal[n] = true
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			f.pos = append(f.pos, args[i+1:]...)
			break
		}
		if a == "-" || !strings.HasPrefix(a, "-") {
			f.pos = append(f.pos, a)
			continue
		}
		if !strings.HasPrefix(a, "--") {
			return f, fmt.Errorf("unknown flag %s (flags are long: --name)", a)
		}
		name, value, hasValue := strings.Cut(a[2:], "=")
		switch {
		case isBool[name]:
			if hasValue {
				return f, fmt.Errorf("--%s takes no value", name)
			}
			f.bools[name] = true
		case isVal[name]:
			if !hasValue {
				if i+1 >= len(args) {
					return f, fmt.Errorf("--%s needs a value", name)
				}
				i++
				value = args[i]
			}
			f.vals[name] = value
		default:
			return f, fmt.Errorf("unknown flag --%s", name)
		}
	}
	return f, nil
}

// usageErr prints "sbtel <cmd>: <err>" and the command's usage line, and returns exit code 2.
func usageErr(e env, cmd string, err error) int {
	fmt.Fprintf(e.stderr, "sbtel %s: %v\nusage: sbtel %s\n", cmd, err, commands[cmd].usage)
	return 2
}

// readInputs reads each path for command cmd; "-" is stdin and may appear at most once. It is
// named "<stdin>" in messages. Diagnostics start "sbtel <cmd>: " (DESIGN.md §3.1). A second "-" is a
// usage error and any IO error is printed; both return exit code 2.
func readInputs(e env, cmd string, paths []string) ([]engine.File, int) {
	var files []engine.File
	usedStdin := false
	for _, p := range paths {
		var b []byte
		var err error
		name := p
		if p == "-" {
			if usedStdin {
				return nil, usageErr(e, cmd, errTwoStdin)
			}
			usedStdin, name = true, "<stdin>"
			b, err = io.ReadAll(e.stdin)
		} else {
			b, err = os.ReadFile(p)
		}
		if err != nil {
			fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
			return nil, 2
		}
		files = append(files, engine.File{Name: name, Src: string(b)})
	}
	return files, 0
}

// runCLI hands a command to __api.cli in a fresh engine, prints what it returns and returns its
// exit code. An engine failure is exit 2.
func runCLI(e env, cmd string, args any) int {
	en, err := engine.New()
	if err != nil {
		fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
		return 2
	}
	r, err := en.CLI(cmd, args)
	if err != nil {
		fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
		return 2
	}
	fmt.Fprint(e.stdout, r.Stdout)
	fmt.Fprint(e.stderr, r.Stderr)
	return r.Exit
}
