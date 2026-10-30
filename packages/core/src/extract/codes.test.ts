import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectVerificationCode } from "./codes.ts";

const code = (subject: string, text: string) => detectVerificationCode({ subject, text });

describe("detectVerificationCode", () => {
  it("finds codes in the usual shapes", () => {
    assert.equal(code("G-482913 is your Google verification code", "Enter this code to finish signing in."), "482913");
    assert.equal(code("Your Uber code", "Your Uber code: 4821. Never share this code."), "4821");
    assert.equal(code("Sign in to Slack", "Use 123-456 to sign in. This code expires in 10 minutes."), "123456");
    assert.equal(code("Your Apple ID Code", "Your Apple ID Code is: 774310. Don't share it with anyone."), "774310");
    assert.equal(code("Microsoft account security code", "Please use the following security code for the account jo*****@gmail.com.\n\nSecurity code: 905521\n\nIf you don't recognize the account, you can click here to remove your email."), "905521");
    assert.equal(code("Verify your email", "Hi Jiayang,\n\n  318 204\n\nis your verification code. It expires in 10 minutes."), "318204");
    assert.equal(code("Your one-time passcode", "Your passcode is K7Q2ZP. It expires soon."), "K7Q2ZP");
  });

  it("prefers the code over other numbers in the same message", () => {
    assert.equal(
      code("Your verification code", "Order #883221 placed on 10/30/2026.\nYour verification code is 610482.\nCall 1-800-555-0199 with questions. © 2026 Shop Inc."),
      "610482",
    );
  });

  it("ignores mail that isn't about a code", () => {
    assert.equal(code("Your order has shipped", "Order 482913 is on its way. Tracking number 1Z999AA10123456784."), null);
    assert.equal(code("20% off this weekend", "Use code SAVE20 at checkout for 20% off. Ends 11/02."), null);
    assert.equal(code("Lunch?", "Want to grab lunch at 1230 near 5th street? Room 4412."), null);
  });

  it("doesn't take a year or a price for a code", () => {
    assert.equal(code("Verify your email address", "Click the button to verify your email.\n\n© 2026 Acme, Inc. 123 Main St."), null);
    assert.equal(code("Confirm your payment", "Your verification is complete. Total: $1250 charged."), null);
  });

  it("ignores codes inside links and addresses", () => {
    assert.equal(code("Verify your account", "Verify here: https://example.com/verify?token=884213 or write to 884213@help.example.com"), null);
  });
});
