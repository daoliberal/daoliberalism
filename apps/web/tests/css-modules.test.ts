import { expect, it } from "vitest";
import styles from "./fixtures/sample.module.css";

it("css_module_class_names_are_literal_in_tests", () => {
  expect(styles.w10).toBe("w10");
});
