// @sbtel file Sbtel.Engine

// Package engine runs the shared JS core (core/core.js + core/api.js) in goja.
//
// An *Engine is NOT safe for concurrent use (goja runtimes are single-threaded). Use one per
// goroutine, or guard one with a mutex; New costs a few tens of milliseconds (it compiles the core).
package engine

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/dop251/goja"

	"github.com/shashi/sbtel"
)

// Engine is one goja runtime with the core and api loaded.
type Engine struct {
	vm  *goja.Runtime
	api *goja.Object
}

// New loads the embedded core and api.
func New() (*Engine, error) { return NewFrom(sbtel.CoreJS, sbtel.APIJS) }

// NewFrom loads the given core and api sources (tests and tools; the binary uses New).
func NewFrom(coreJS, apiJS string) (*Engine, error) {
	vm := goja.New()
	if _, err := vm.RunScript("core/core.js", coreJS); err != nil {
		return nil, fmt.Errorf("loading core/core.js: %s", jsMessage(err))
	}
	if _, err := vm.RunScript("core/api.js", apiJS); err != nil {
		return nil, fmt.Errorf("loading core/api.js: %s", jsMessage(err))
	}
	v := vm.Get("__api")
	if v == nil || goja.IsUndefined(v) {
		return nil, errors.New("core/api.js did not define __api")
	}
	return &Engine{vm: vm, api: v.ToObject(vm)}, nil
}

// Call invokes __api[name](args...) and returns its result as a string (every public api
// function returns canonical JSON or text). A JS exception becomes an error carrying the
// exception's message (not goja's err.Error(), which appends a JS stack).
func (e *Engine) Call(name string, args ...any) (string, error) {
	fn, ok := goja.AssertFunction(e.api.Get(name))
	if !ok {
		return "", fmt.Errorf("core/api.js has no function %q", name)
	}
	vals := make([]goja.Value, len(args))
	for i, a := range args {
		vals[i] = e.vm.ToValue(a)
	}
	out, err := fn(goja.Undefined(), vals...)
	if err != nil {
		return "", fmt.Errorf("%s: %s", name, jsMessage(err))
	}
	return out.String(), nil
}

// File is one input already read by the host. Name is what messages call it ("-" reads as "<stdin>").
type File struct {
	Name string `json:"name"`
	Src  string `json:"src"`
}

// CLIResult is what __api.cli returns: the process exit code and the text to print.
type CLIResult struct {
	Exit   int    `json:"exit"`
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
}

// CLI runs __api.cli(cmd, args): command logic and output formats live in core/api.js so the
// node conformance run can test them too. args must marshal to the object that command expects.
func (e *Engine) CLI(cmd string, args any) (CLIResult, error) {
	b, err := json.Marshal(args)
	if err != nil {
		return CLIResult{}, err
	}
	s, err := e.Call("cli", cmd, string(b))
	if err != nil {
		return CLIResult{}, err
	}
	var r CLIResult
	if err := json.Unmarshal([]byte(s), &r); err != nil {
		return CLIResult{}, fmt.Errorf("cli %s: bad result from core/api.js: %v", cmd, err)
	}
	return r, nil
}

func jsMessage(err error) string {
	var ex *goja.Exception
	if errors.As(err, &ex) {
		if o, ok := ex.Value().(*goja.Object); ok {
			if m := o.Get("message"); m != nil && !goja.IsUndefined(m) {
				return m.String()
			}
		}
		return ex.Value().String()
	}
	return err.Error()
}
