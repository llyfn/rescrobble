import { openApp } from "../src/openApp.ts";

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => void openApp());
});
