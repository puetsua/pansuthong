import {
  gfmTaskListItemFromMarkdown,
  gfmTaskListItemToMarkdown,
} from "mdast-util-gfm-task-list-item";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import type { Root } from "mdast";
import type { Plugin } from "unified";

type RemarkParserData = {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
  toMarkdownExtensions?: unknown[];
};

/** GFM task list items only — no tables, strikethrough, footnotes, or autolinks. */
export const remarkTaskListOnly: Plugin<[], Root> = function remarkTaskListOnly() {
  const data = this.data() as RemarkParserData;

  const micromarkExtensions =
    data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions =
    data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);
  const toMarkdownExtensions =
    data.toMarkdownExtensions || (data.toMarkdownExtensions = []);

  micromarkExtensions.push(gfmTaskListItem());
  fromMarkdownExtensions.push(gfmTaskListItemFromMarkdown());
  toMarkdownExtensions.push(gfmTaskListItemToMarkdown());
};
