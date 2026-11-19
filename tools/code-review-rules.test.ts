// Static fixtures only: clients and inputs are injected stubs, and no case is invoked.
type MockFetch = (
  url: string,
  request?: { method: string; body: string },
) => Promise<{ text(): Promise<string> }>;

function requestWithTypedInput(fetch: MockFetch, process: { env: Record<string, string> }) {
  const sample: string = process.env["FIXTURE_INPUT"];
  // ruleid: sensitive-data-outbound
  fetch("fixture", { method: "POST", body: sample });
  // ok: sensitive-data-outbound
  fetch("fixture", { method: "POST", body: "sample" });
}

async function compileTypedResponse(fetch: MockFetch) {
  const response = await fetch("fixture");
  const body: string = await response.text();
  // ruleid: remote-content-execution
  new Function(body);
  // ok: remote-content-execution
  String(body);
}
