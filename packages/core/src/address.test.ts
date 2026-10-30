import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAddress, htmlToText, makeSnippet, parseAddressList } from "./address.ts";

test("address lists handle quoted names with commas", () => {
  assert.deepEqual(parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.com; Ann <ann@z.io>'), [
    { name: "Doe, Jane", address: "jane@x.com" },
    { address: "bob@y.com" },
    { name: "Ann", address: "ann@z.io" },
  ]);
  assert.deepEqual(parseAddressList(""), []);
  assert.deepEqual(parseAddressList("not an address"), []);
});

test("formatAddress quotes names that need it", () => {
  assert.equal(formatAddress({ name: "Doe, Jane", address: "jane@x.com" }), '"Doe, Jane" <jane@x.com>');
  assert.equal(formatAddress({ name: "Ann", address: "ann@z.io" }), "Ann <ann@z.io>");
});

test("snippets flatten whitespace, drop quoted lines and truncate", () => {
  assert.equal(makeSnippet("Hello\n\n> quoted\nworld"), "Hello world");
  assert.equal(makeSnippet("x".repeat(200), 10).length, 10);
  assert.equal(htmlToText("<p>Hi&nbsp;<b>there</b></p><style>x{}</style>"), "Hi there");
});
