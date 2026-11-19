// Static fixtures only: clients and inputs are injected stubs, and no case is invoked.
function requestBodies(fetch, process, axios, Deno, navigator, document) {
  const sample = process.env.FIXTURE_INPUT;
  const body = JSON.stringify({ sample });
  // ruleid: sensitive-data-outbound
  fetch("fixture", { method: "POST", body });

  const otherSample = Deno.env.get("FIXTURE_INPUT");
  // ruleid: sensitive-data-outbound
  axios.post("fixture", otherSample);
  // ruleid: sensitive-data-outbound
  navigator.sendBeacon("fixture", document.cookie);
}

function readOnlyConfiguration(fetch, process, render) {
  const config = process.env.FIXTURE_SETTING;
  // ok: sensitive-data-outbound
  render(config);
  // ok: sensitive-data-outbound
  fetch("fixture");
  // ok: sensitive-data-outbound
  fetch("fixture", { method: "POST", headers: { fixture: config }, body: "sample" });
  // ok: sensitive-data-outbound
  fetch(config, { method: "POST", body: "sample" });
  // ok: sensitive-data-outbound
  fetch("fixture", { method: "POST", body: JSON.stringify({ theme: "light" }) });
}

async function evaluateResponse(fetch) {
  const response = await fetch("fixture");
  const downloaded = await response.text();
  // ruleid: remote-content-execution
  eval(downloaded);
}

async function processResponse(fetch, require) {
  const child = require("node:child_process");
  const response = await fetch("fixture");
  const downloaded = await response.text();
  // ruleid: remote-content-execution
  child.execFile(downloaded);
  // ok: remote-content-execution
  child.spawn("fixture", [downloaded]);
}

async function dataOnly(fetch, store) {
  // ok: remote-content-execution
  const response = await fetch("fixture");
  const downloaded = await response.text();
  // ok: remote-content-execution
  store(downloaded);
  // ok: remote-content-execution
  eval(String(response.status));
}

async function separateNetworkAndLocalInputs(fetch, localResponse, localRunner) {
  // ok: remote-content-execution
  await fetch("fixture");
  const localText = await localResponse.text();
  // ok: remote-content-execution
  eval(localText);
  const response = await fetch("fixture");
  const downloaded = await response.text();
  // ok: remote-content-execution
  localRunner.exec(downloaded);
}

async function replacedResponse(fetch, localResponse) {
  let response = await fetch("fixture");
  response = localResponse;
  // ok: remote-content-execution
  eval(await response.text());
}
