import { useState } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

/** Full-width WYSIWYG markdown editing, blended straight into the card
 *  (no nested box). `initialMd` is captured once per mount — the toggle
 *  remounts the editor each time it opens, so it always starts fresh
 *  while `onChange` streams edits out continuously. */
export function MarkdownEditor({
  initialMd,
  onChange,
}: {
  initialMd: string;
  onChange: (v: string) => void;
}) {
  const [initial] = useState(initialMd);
  return (
    <MDXEditor
      markdown={initial}
      onChange={onChange}
      contentEditableClassName="md-preview"
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        markdownShortcutPlugin(),
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <UndoRedo />
              <BoldItalicUnderlineToggles />
              <ListsToggle />
              <BlockTypeSelect />
            </>
          ),
        }),
      ]}
    />
  );
}
