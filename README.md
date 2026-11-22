# norph

Text that morphs into its next value, on iOS, Android, and web. It is a
Reanimated port of [torph](https://github.com/lochie/torph)'s React component.
One implementation runs everywhere, on the web through react-native-web.

[Try the live demo](https://glpecile.github.io/norph/).

```tsx
import { MorphText } from 'norph';

<MorphText className="text-2xl text-foreground self-start">{count}</MorphText>;
```

## Behavior

- Words and characters that the old and new text share slide to their new
  places. New ones enter, dropped ones exit, and the box animates its width.
- Numbers match digits by place value and align on the decimal point. A
  changed digit rolls in a clipped slot. Other characters crossfade.
- The first render does not animate. At rest, and with reduced motion or
  `numberOfLines`, it renders one plain `Text`.
- Screen readers read the whole string once.
- Timing is torph's: 400 ms on `cubic-bezier(0.19, 1, 0.22, 1)`.

## Props

| Prop | Type | |
| --- | --- | --- |
| `children` | `string \| number` | The current text. |
| `className` | `string` | Text classes reach every glyph. Layout classes reach the outer box. Needs an app that resolves `className` on core components, such as Uniwind. |
| `style` | `TextStyle` | Split the same way as `className`. |
| `numberOfLines` | `number` | Opts out of the morph. |

## Limits

- One line. The text never wraps: at rest, text too long for its box ends in
  an ellipsis. Newlines are not supported.
- While it morphs, the text sits at the start edge. Shrink-wrap it
  (`alignSelf`) when alignment matters.
- One node per glyph loses kerning pairs during a morph.
- Unlike torph, the digit slot has a hard edge (no gradient mask) and a morph
  that is interrupted does not carry its velocity over.

## Peer dependencies

`react`, `react-native`, `react-native-reanimated` 4, and `react-native-worklets`.
The package ships TypeScript source for Metro to compile.

## Develop

`bun test` runs the diff tests and `bun run typecheck` checks types. The demo
lives in `example/`: `cd example && bun install && bun web` runs it, and
`bun run export` builds it into `site/demo/` for the site in `site/`.

## License

MIT. Includes code from torph, copyright (c) 2025 Lochie Axon.
