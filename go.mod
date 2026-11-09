module github.com/shashi/sbtel

go 1.24

require github.com/dop251/goja v0.0.0-20260603125802-cfe4039cb6d7

require (
	github.com/dlclark/regexp2 v1.11.4 // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	golang.org/x/text v0.22.0 // indirect
)

// golang.org/x/text cannot be fetched through this workspace's proxy, so it resolves to a local
// copy of the github.com/golang/text mirror at tag v0.22.0 (third_party/README.md). Do not run
// `go mod tidy` (it tries to fetch goja's test-only deps); edit this file by hand.
replace golang.org/x/text => ./third_party/xtext
