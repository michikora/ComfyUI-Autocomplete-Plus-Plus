<div align="center">

# Autocomplete++

![](./assets/comfy/banner.png)

## [English](README.md) · 日本語

[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 向けのタグ補完・プロンプト自動整形・ダイナミックプロンプト展開拡張機能。

[機能](#機能) · [インストール](#インストール) · [ショートカット一覧](#ショートカット一覧) · [構文例](#構文例) · [カスタム辞書とワイルドカード](#カスタム辞書とワイルドカード) · [設定一覧](#設定一覧) · [プロジェクトについて](#プロジェクトについて) · [謝辞](#謝辞) · [ライセンス](#ライセンス)

![](./assets/images/img01.webp)

</div>

## 概要

**Autocomplete++** は、ComfyUI のテキスト入力に対してタグ補完、LoRA / Embedding 候補表示、ダイナミックプロンプトおよびワイルドカードの展開、プロンプトの自動整形、編集用ショートカットキーを提供する拡張機能です。ComfyUI Node 2.0 および従来の LiteGraph UI の両方に対応しています。

本プロジェクトは、[newtextdoc1111](https://github.com/newtextdoc1111) 氏による [ComfyUI-Autocomplete-Plus](https://github.com/newtextdoc1111/ComfyUI-Autocomplete-Plus) をベースにリファクタリングおよび機能拡張を行ったものです。

---

## インストール

### ComfyUI-Manager

[ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager) で `Autocomplete++` と検索して表示されたカスタムノードをインストールし、再起動します。

### 手動インストール

このリポジトリを ComfyUI の `custom_nodes` フォルダにクローンまたはコピーします。
`git clone https://github.com/michikora/ComfyUI-Autocomplete-Plus-Plus.git`

---

## 機能

### 1. タグ補完

- **タグ・エイリアス・翻訳検索**: Danbooru および e621 のタグ、別名（エイリアス）、翻訳をリアルタイムで検索・補完します。
- **カテゴリ別の色分け**: Danbooru の配色規則（General、Artist、Copyright、Character、Meta）に準拠したカラー表示を行います。
- **特殊プレフィックス補完**:
    - `<lora:` &rarr; インポート済みの LoRA をサブフォルダ階層付きで一覧表示し、プレビューサムネイルを表示します。
    - `embedding:` / `emb:` &rarr; インポート済みの Embedding（Textual Inversion）を一覧表示します。
    - `__` &rarr; ワイルドカードのファイルやフォルダを補完します。パスの末尾にスラッシュを付けた場合（例: `__folder/file/`）は、ファイル内の各行（テキスト候補）を一覧表示して個別に選択・挿入できます。
    - `@` &rarr; Anima 系モデル使用時に、専用のアーティスト記法（@プレフィックス）の検索・挿入に対応。（Anima モード有効時は、通常検索から絵師タグを選択した場合でも自動的に `@` が先頭に付与されます）
    - `/artist`、`/character`、`/copyright`、`/general`、`/meta`、`/danbooru`、`/e621` &rarr; カテゴリまたは辞書で検索結果を絞り込みます。辞書 &rarr; カテゴリ &rarr; 検索語句 をスラッシュで繋げた多段階の絞り込み（例: `/danbooru /artist query` や `/danbooru artist query`）にも対応しています。
- **Wiki リンク**: Danbooru / e621 タグ候補の `WIKI` ボタンをクリックするか `F1` キーを押すと、公式 Wiki ページを開きます。
- **LoRA Manager 連携（トリガーワード & LoRA 詳細表示）**:
  [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) が有効な環境では、以下の連携機能が自動で提供されます：
    - `<trigger:` &rarr; 現在使用中の LoRA のトリガーワードを一覧表示します。候補の選択・ホバー時にプレビューカードやプロンプトプリセットが表示され、カード内の **「Insert Full Set ↵」** をクリックすることで、プリセットに含まれるすべてのタグをプロンプトへ一括挿入できます。
    - **LoRA の詳細情報**: トリガーワード候補で `INFO` ボタンをクリックするか `F1` キーを押すと、LoRA の詳細画面が開きます（同じトリガーワードを持つ LoRA が複数存在する場合はモデル選択メニューが開き、数字キー `1`〜`9` でローカル詳細を開き、`Ctrl + 1`〜`9` で外部ページを開きます）：
        - **基本情報**: ファイル名、ファイルパス（クリックでコピー可能）、ベースモデル、バージョン、ファイルサイズ、Civitai / Hugging Face リンクを表示。
        - **推奨設定・メモ**: ユーザーメモを表示。また、LoRA Manager 側で設定または取得されている場合は、推奨適用強度（Strength）、推奨範囲、Clip 設定、モデル解説を表示。
        - **トリガーワード & プリセット**: トリガーワード一覧（個別クリックでタグをコピー、「Copy All」で一括コピー）や複合プロンプトプリセット（個別コピーボタン付き）を表示。
        - **作例ギャラリー & 生成メタデータ**: ローカルおよびリモートの作例画像をギャラリー形式で閲覧（左右矢印キー `Left` / `Right` やサムネイルのスクロールに対応）。画像をクリックすると生成メタデータが表示され、プロンプト、ネガティブプロンプト、サンプラー、シード値、ステップ数、CFG スケールなどをコピー可能。
        - **LoRA Manager 連携**: フッターのリンクから ComfyUI-Lora-Manager 上の該当 LoRA 画面へ移動。

<div align="center">

![](./assets/images/img02.webp)
![](./assets/images/img03.webp)

</div>

---

### 2. ダイナミックプロンプト & ワイルドカード

- **シード値連動・順次選択・前回抽選結果の保持**:
    - **Follow Seed**: ダイナミックプロンプトの選択肢やワイルドカードの抽選を生成シード値と連動させ、生成結果の再現性を維持できます。
    - **Keep Last Choice**: KSampler のマスターシード値が変更されない限り、前回の生成で選ばれた組み合わせをそのまま固定して再利用します。ランダム抽選で気に入った組み合わせが出た際に、シード値と抽選結果を固定したままプロンプトの微調整を行ったり、Hires.fix や ADetailer などのマルチパス生成用途で抽選結果を固定する際に利用できます。
    - **Sequential**: 生成を実行するたびに、ワイルドカードファイル内の行を上から順に 1 行ずつ選択します。
    - **PNG 読み込み時の抽選結果復元（実験的機能）**: **Keep Last Choice** モードが有効な状態で、生成情報を含む PNG 画像を ComfyUI にドラッグ＆ドロップまたは読み込んだ際、元画像で実際に選ばれていたダイナミックプロンプトやワイルドカードの抽選結果を自動的に復元します。マスターシード値を変更しない限り、復元された組み合わせがそのまま維持され、意図しない再抽選を防ぎます。
        - _注意事項_: 復元できるのはダイナミックプロンプトの選択肢およびローカル環境に実際にインストールされている同一のワイルドカード項目に限られます。また、`.json` ファイルから読み込んだワークフローや、プロンプト情報（`prompt`）が含まれていない PNG 画像では機能しません。なお、ハードウェアや実行環境の違いにより、生成結果の完全な再現性を保証するものではありません。
- **マルチパス間の一貫性**: 1 回の生成実行において、Pass 1、Hires.fix、ADetailer / FaceDetailer などの各パス間で同一の抽選結果を共有・維持します。
- **対応構文**:
    - **選択肢 (Choices)**: `{red hair | blue hair | green hair}` &rarr; いずれか 1 つをランダム選択（例: `red hair`）
    - **重み付き選択肢 (Weighted Choices)**: `{3::sunny, outdoors | 1::rainy, indoors}` &rarr; 3:1 の確率比率で選択（75% の確率で `sunny, outdoors`）
    - **組み合わせ (Combinations)**: `{2$$red | blue | green}` &rarr; 重複なく 2 つを選んでカンマ結合（例: `red, green`）
    - **カスタム区切り文字 (Custom Separators)**: `{1-3$$ and $$apples | bananas | oranges}` &rarr; 1〜3 個を選んで指定文字で結合（例: `apples and oranges`）
    - **ワイルドカード (Wildcards)**: `__clothing/dresses__` &rarr; 該当ファイルから 1 行を選択（選択肢 `{ __clothing/dresses__ | __clothing/suits__ }` 内でも使用可。`.txt` 形式に対応）
    - **エスケープ構文 (Literal Escaping)**: `\{`、`\}`、`\__` &rarr; 波括弧や連続アンダースコアをエスケープし、ダイナミックプロンプトやワイルドカードとして展開せずそのまま出力
    - **非選択肢構文の保護**: JSON 構文（`{"key": "value"}`）や区切り文字のない単一の波括弧（`{tag}`）など、選択肢ではない波括弧は展開エンジンによる変換を行わず、そのまま保持されます。

---

### 3. キーボードショートカット & プロンプト編集

- **タグ・LoRA の重み調整 (`Ctrl + Up / Down`)**:
    - **通常のタグ（単語・フレーズ）**: カーソル位置にあるタグの境界全体（例: `long hair` &rarr; `(long hair:1.05)`）を自動認識し、単語単位で `long (hair:1.05)` のように分断されるのを防ぎます。テキスト選択時は選択範囲全体に適用されます。
    - **括弧付きタグ・Embedding**: 既に設定されている重み数値を設定ステップ単位で増減（`Ctrl + Up` で増加、`Ctrl + Down` で減少）させます。`embedding:` や `emb:` プレフィックス付きのタグ（例: `(embedding:easynegative:1.05)`）にも対応しています。重みが `1.0` に戻った場合は、外側の丸括弧が自動的に削除されて通常のタグ（例: `(1girl:1.05)` &rarr; `1girl`）に戻ります。
    - **LoRA**: `<lora:name>`、`<lora:name:1.0>`、`<lyco:name:1.0>`、`<name:1.0>` の各記法に対応しています。重みが記載されていない場合は自動的に数値を付与（例: `<lora:my_model>` &rarr; `<lora:my_model:1.05>`）し、設定されたステップ単位で増減します。
    - **ステップ値の設定**: **Settings &rarr; Autocomplete** にて、タグ/Embedding 用（`Tag / Embedding Weight Step`）と LoRA 用（`LoRA Weight Step`）の調整ステップ（0.05〜0.50）を個別に変更可能。
- **タグ単位のカーソル移動 (`Ctrl + Left / Right`)**:
    - タグの区切り（カンマ、パイプ、括弧の手前）へカーソルをジャンプ移動します。
    - `{a|b|c}` 選択肢ブロック内の各候補間を移動できます。
- **タグの入れ替え・順序変更 (`Alt + Left / Right`)**:
    - カーソル位置にあるタグを左右の隣接タグと入れ替えます（カーソルは移動したタグに追従します）。
    - `{a|b|c}` 選択肢ブロック内での入れ替えはブロック外にはみ出さず、ブロック内部で完結します。
    - タグを入れ替える際、`{a|b|c}`、`<lora:...>`、`__wildcard__` などのブロック全体を 1 つの単位として飛び越えて移動します。

---

### 4. プロンプト自動整形

- **実行タイミング**: テキストエリアからフォーカスが外れた際に自動でプロンプトを整形します。
- **整形ルール**:
    - カンマ後のスペースを正規化（`1girl,solo` &rarr; `1girl, solo`）。
    - 重複したカンマを統合（`1girl,, solo` &rarr; `1girl, solo`）。
    - プロンプト末尾の余分なカンマを削除（設定により改行末尾のカンマ削除も個別有効化可能）。
    - 通常タグのアンダースコアをスペースに変換（`blue_hair` &rarr; `blue hair`）。
- **除外・保護機能**:
    - 顔文字（例: `^_^`、`>_<`、`-_-`、`|_|`、`o_o;`、`ಠ_ಠ`、`ಥ_ಥ`、`<|>_<|>`）のアンダースコアを保護。
    - `<lora:...>`、`embedding:...`、`__wildcard__` 構文を保護。
    - アンダースコアの維持設定: **Settings &rarr; Formatting &rarr; Keep Underscores for Tags** に保持したいタグ（例: `custom_tag`, `special_style`）を指定することで、スペースに変換せずアンダースコアをそのまま維持できます。
    - `{a|b|c}` 選択肢ブロックの構文を壊すことなく内部のサブタグのみを整形。

---

### 5. タグ使用履歴 & お気に入り

- **お気に入りタグ機能**: タグの使用頻度を記録し、よく使うタグを補完候補の上位に優先表示します（`Favor` バッジを表示）。
- **設定での制御**: 保存件数の上限、有効期限（日数）、最小使用回数の調整や、履歴の消去を設定から行えます。

---

### 6. ノード互換性 & 外部連携

- **キャンバス右クリックメニュー**: キャンバス上のテキスト入力可能なノードを右クリックすると、`Autocomplete++` サブメニューから以下の操作が行えます：
    - **個別ノード単位の切り替え**: 「Disable for this node」（このノードで無効化）/「Enable for this node」（このノードで有効化）により、全体設定を変更することなく特定のノード単体でのみ補完のオン/オフを切り替えられます。「Reset to default for this node」で全体設定に従う標準状態にリセットできます。
    - **ノードタイプ全体の切り替え**: 「Ignore this node type」（このノード種別を無視）/「Unignore this node type」、および「Force override this node type」（このノード種別を強制上書き）/「Remove override for this node type」により、ノードクラス単位での一括除外や補完ポップアップの重複表示防止を設定できます。
    - **標準 Note ノードの初期無効化**: ComfyUI 標準の `Note` ノードは、通常のメモ書きを妨げないよう初期状態では補完の対象外となっています。補完を使用したい場合は、Note ノードを右クリックして「Enable for this node」を選択することで個別に有効化できます。
- **LoRA Path Completion Mode (LoRA パス補完形式)**: **Settings &rarr; Models & Integrations &rarr; LoRA Path Completion Mode** にて、LoRA 補完時に挿入する書式（`Auto` / `Filename Only` / `Full Path`）を設定できます。`Auto` では通常は拡張子を除いたファイル名のみを挿入し、サブフォルダ間に同名 LoRA が存在する場合にのみ相対パスへ自動フォールバックします（LoRA Manager が有効な場合はそのパス構文設定にも自動連動します）。
- **LoRA / Embedding & 外部連携**: LoRA / Embedding の補完やサムネイル表示に対応。また、ComfyUI-Lora-Manager との連携（トリガーワード自動取得、フォールバックプレビュー、LoRA 詳細表示）に対応しています。
- **Anima モデル互換性**: デフォルトでは Anima モデルかどうかを自動検出し、**Settings &rarr; Formatting &rarr; Anima Artist '@' Prefix Mode** から手動で常時有効化または無効化を設定することもできます。

---

### 7. キャンバスコントローラーノード

Autocomplete++ では、ノード追加メニューの **`Autocomplete++`** カテゴリ内に 4 種類のオプションのコントローラーノードを提供しています。

**配線不要**: キャンバス上に配置することで、全体設定を変更することなくそのワークフローの設定を上書きできます。各項目で **Default (From Settings)** を選択した場合は、自動的に全体設定（Settings）を継承します。

**パススルースロット（オプション）**: すべてのコントローラーノードにはオプションとして `passthrough` 入出力スロットが備わっています。配線しなくても配置するだけで設定は有効になりますが、ワークフローの配線を整理したい場合やパイプラインの途中に挟み込みたい場合に、MODEL や CLIP、IMAGE、PIPE など任意のデータ型をそのまま無変更で通過（パススルー）させることができます。

- **`Autocomplete++ Wildcard & Dynamic Controller`**:
    - プロンプト展開エンジンのオンオフ、ワイルドカード抽選モード、ダイナミックプロンプト抽選モードをワークフロー単位で上書きします。
- **`Autocomplete++ Formatting Controller`**:
    - フォーカスが外れた時の自動整形、カンマ後のスペース追加、文末および行末のカンマ削除、アンダースコアをスペースへ置換、丸括弧エスケープ、カンマ自動挿入、Anima 絵師モード（`@`）、およびアンダースコア維持タグの指定（全体設定に追加、または完全上書き）などの設定をワークフロー単位で上書きします。
- **`Autocomplete++ Integrations Controller`**:
    - LoRA / Embedding 補完機能の有効化、LoRA パス補完形式、および ComfyUI-Lora-Manager 連携モードをワークフロー単位で上書きします。
- **`Autocomplete++ Dictionaries Controller`**:
    - メインタグ辞書、翻訳ファイル、追加辞書をワークフロー単位で上書きします。追加辞書入力欄には専用の CSV 辞書補完ピッカーが内蔵されています。

#### 複数ノード配置時の優先ロジック

- **ミュート / バイパス の自動認識**: ミュート（`Ctrl + M`）またはバイパス（`Ctrl + B`）されたコントローラーノードは自動的に制御対象から外れるため、キャンバス上に複数のプリセットノードを配置し、Mute や Bypass で適用対象を切り替える運用が可能です。
- **直近操作ノードの優先（Last-Interacted Priority）**: 同一種類のコントローラーがキャンバス上に複数存在する場合、直近で設定を変更・操作したノードが優先されます。
- **最新作成ノード優先（Highest Node ID Fallback）**: 操作履歴がない場合は、ID が最も大きい（最新に作成された）有効なノードが優先されます。

#### 有効状態ステータスバッジ

- **単一コントローラー時の挙動**: キャンバス上に同種コントローラーが 1 つだけの場合は、画面をシンプルに保つためバッジは表示されません。
- **複数コントローラー配置時の表示**: 同種コントローラーが複数配置された場合：
    - 現在有効なノードの下部に **`Active`** バッジが表示されます。
    - 優先されていない重複ノードには **`Inactive`** バッジが表示され、ホバー時にどのノードが有効（アクティブ）かをツールチップで確認できます。 **`Inactive`** バッジをクリックするとそのノードをアクティブ（優先ノード）に切り替えることができます。
- **UI 互換性について**: ステータスバッジの表示は現在 Node 2.0 に対応しています。優先ノードおよび Mute/Bypass 判定ロジック自体は旧UI環境でも動作しますが、旧UI上ではステータスバッジが表示されません。

---

## ショートカット一覧

| ショートカット                       | 状態・コンテキスト                                 | 動作                                                        |
| :----------------------------------- | :------------------------------------------------- | :---------------------------------------------------------- |
| **`Tab`** / **`Enter`**              | 補完候補の表示中                                   | 選択中の候補を挿入                                          |
| **`Up`** / **`Down`**                | 補完候補の表示中                                   | 候補リストを上下に移動                                      |
| **`PageUp`** / **`PageDown`**        | 補完候補の表示中                                   | 候補リストを 5 件ずつスキップ移動                           |
| **`Esc`** / **`Left`** / **`Right`** | 補完候補の表示中                                   | 補完候補を閉じる                                            |
| **`F1`**                             | Danbooru/e621 タグまたはトリガーワード候補の選択中 | Danbooru / e621 Wiki、または LoRA 詳細画面 / Civitai を開く |
| **`1` 〜 `9`**                       | トリガーワード重複時の LoRA 選択メニュー表示中     | 該当 LoRA の詳細を開く                                      |
| **`Ctrl + 1` 〜 `9`**                | トリガーワード重複時の LoRA 選択メニュー表示中     | 該当 LoRA の Civitai / HF ページを開く                      |
| **`Left` / `Right`**                 | LoRA 詳細画面の表示中                              | ギャラリー内の作例画像を前後に切り替え                      |
| **`Esc`**                            | LoRA 詳細画面の表示中                              | メタデータ表示または詳細画面を閉じる                        |
| **`Ctrl + Up / Down`**               | テキストエリア内                                   | カーソル位置のタグ、Embedding、LoRA の重みを調整            |
| **`Ctrl + Left / Right`**            | テキストエリア内                                   | タグの区切り単位でカーソルをジャンプ移動                    |
| **`Alt + Left / Right`**             | テキストエリア内                                   | 現在のタグを左右のタグと入れ替え                            |

---

## 構文例

### 通常タグと重み付け

```text
masterpiece, 1girl, solo, long hair, (blue eyes:1.2), (smile:0.9)
```

### Anima 向け絵師タグ

```text
masterpiece, 1girl, @artist_name1, @artist_name2
```

### LoRA & Embedding

```text
<lora:anime_style_v2:0.8>, (embedding:easynegative:1.1)
```

### ワイルドカード

```text
__backgrounds/scenery__, __clothing/dresses__
```

### ダイナミックプロンプト

```text
{day | sunset | night}
{3::outdoors, sunny | 1::indoors, room}
{2$$red ribbons | blue ribbons | green hairband | flower hairclip}
{1-3$$ and $$masterpiece | best quality | highres}
```

---

## カスタム辞書とワイルドカード

> 本拡張機能には基本的な辞書csvファイルのみが含まれています。タグの翻訳表示やワイルドカード機能を利用する場合は、対応する `.csv` または `.txt` ファイルを各自で用意し、以下の対応フォルダに配置してください。

### カスタムタグ CSV ファイル

独自のタグ CSV ファイルを `tags/` フォルダに配置します：

```csv
tag,category,count,aliases
masterpiece,5,9999999,"master piece,best"
```

追加したタグファイルは、**ComfyUI Settings &rarr; Autocomplete++ &rarr; Tags & Dictionaries &rarr; Extra Tag Files** から選択して読み込めます。

### 翻訳 CSV ファイル

タグの翻訳表示および翻訳検索を有効にするには、2 列または 3 列の CSV ファイルを `tags/translations/` に配置します：

```csv
tag,translation
1girl,女の子
long_hair,ロングヘア
```

その後、**ComfyUI Settings &rarr; Autocomplete++ &rarr; Translation &rarr; Translation File** から該当の翻訳ファイルを選択します。

### ワイルドカードファイル

`.txt` ファイルを以下のいずれかの場所に配置します：

- `ComfyUI-Autocomplete-Plus-Plus/wildcards/`
- `ComfyUI/wildcards/`
- 各種カスタムノードの wildcards フォルダ（例: `ComfyUI/custom_nodes/*/wildcards/`）

---

## 設定一覧

ComfyUI の設定ダイアログ（Settings）内の **Autocomplete++** から設定できます：

1. **Autocomplete**:
    - `Enable Autocomplete`: タグ補完機能全体の有効/無効切り替え。
    - `LoRA Weight Step`: `Ctrl + Up / Down` で LoRA の重みを調整する際の変更ステップ量（スライダー: 0.05〜0.50、デフォルト: 0.05）。
    - `Tag / Embedding Weight Step`: `Ctrl + Up / Down` で通常タグおよび Embedding の重みを調整する際の変更ステップ量（スライダー: 0.05〜0.50、デフォルト: 0.05）。
    - `Insert Suggestion with`: 候補を確定・挿入するキー（`Tab` / `Enter` / 両方）の選択。
    - `Ignore Nodes`: 補完を無効化するノード名またはキーワードをカンマ区切りで指定。
    - `Override Nodes`: 補完を優先的に有効化するノード名またはキーワードをカンマ区切りで指定。
    - `Enable Console Debug Logs`: デバッグ用のログをブラウザの開発者ツール（F12）コンソールに出力。
2. **Display**:
    - `Floating Preview Card Position`: LoRA / Embedding サムネイルの表示位置（`Left` / `Right` / `Disabled`）。
    - `Max Suggestions Count`: ポップアップ内に表示する最大候補数（デフォルト: 15）。
    - `Show Wiki Badge`: Wiki ページが存在するタグに `WIKI` ボタンを表示（現在は Danbooru および e621 辞書に対応しており、CSV ファイル名に「danbooru」または「e621」が含まれている必要があります）。
    - `Prioritize Frequently Used Tags (Favor)`: よく使うタグを `Favor` バッジ付きで優先表示。
    - `Favor Threshold / Validity / Capacity`: お気に入りタグの最小使用回数、保持日数、最大保存件数の設定。
    - `Clear Favor History`: 保存されているタグ使用履歴を消去。
3. **Formatting**:
    - `Anima Artist '@' Prefix Mode`: 絵師タグの `@` プレフィックス処理（`Auto` / `Enabled` / `Disabled`）。
    - `Auto-Insert Comma`: タグ挿入時にカンマとスペースを自動追加。
    - `Replace Underscore with Space`: タグ挿入時にアンダースコアをスペースに置換。
    - `Escape Parentheses`: 入力された丸括弧を自動エスケープ（例: `tag (qualifier)` &rarr; `tag \(qualifier\)`）。
    - `Auto Format on Blur`: フォーカスが外れた際にプロンプトを自動整形。
    - `Auto Format Rules`: カンマ後のスペース、プロンプト末尾カンマ削除、改行末尾カンマ削除、アンダースコア置換の個別切り替え。
    - `Keep Underscores for Tags`: アンダースコアをスペースに置換せず維持するタグをカンマ区切りで指定。
4. **Models & Integrations**:
    - `Enable LoRAs and Embeddings`: `<lora:` および `embedding:` 補完機能のオンオフ。
    - `LoRA Path Completion Mode`: LoRA 補完時にファイル名のみを挿入するか、相対パスを含めるかの設定（`Auto` / `Filename Only` / `Full Path`）。
    - `LoRA Manager Integration`: LoRA Manager からのトリガーワード取得、フォールバックプレビュー、LoRA 詳細画面の連携機能（`Auto` / `Enabled` / `Disabled`）。
5. **Shortcuts & Interaction**:
    - `Enable Hotkey Enhance`: プロンプト編集ショートカットの一括有効/無効切り替え。
    - `Hotkey Rules`: タグ全体の重み調整（`Ctrl+Up/Down`）、タグ移動（`Ctrl+Left/Right`）、タグ入れ替え（`Alt+Left/Right`）の個別切り替え。
6. **Tags & Dictionaries**:
    - `Main Tag File`: `tags/` から読み込むメインタグ CSV ファイルの選択。
    - `Extra Tag Files`: 追加で読み込むタグ辞書 CSV ファイルの複数選択。
    - `Translation File`: `tags/translations/` から読み込む翻訳 CSV ファイルの選択。
7. **Translation**:
    - `Search by Translation`: 翻訳名（日本語など）でのタグ検索を有効化。
    - `Show Translations in Suggestions`: 候補リスト内に英語タグと並べて翻訳名を表示。
    - `Old 3-column format`: 従来の 3 列形式翻訳 CSV との互換モード。
8. **Wildcards & Dynamic Prompts**:
    - `Enable Prompt Expansion Engine`: プロンプト展開エンジンのオンオフ。
    - `Wildcards Mode`: ワイルドカードの抽選モード（`Random`, `Follow Seed`, `Keep Last Choice`, `Sequential`）を設定。
    - `Dynamic Prompts Mode`: ダイナミックプロンプトの抽選モード（`Random`, `Follow Seed`, `Keep Last Choice`）を設定。

---

## プロジェクトについて

本プロジェクトは個人の趣味として余暇の時間に開発を行っているものです。そのため、時間および対応能力の都合上、以下の点についてあらかじめご理解をお願いいたします：

- **Issue（不具合報告・要望）**: 返答や修正の対応が遅れる場合があります。気長にお待ちいただけますと幸いです。
- **Pull Request（PR）**: 外部からのコードを適切にレビュー・検証・管理する十分な時間とリソースが取れないため、現在は原則として Pull Request の受け入れを行っておりません。ご不便をおかけして誠に申し訳ありません。
- **Fork・独自ブランチの作成**: [MIT License](LICENSE) のもとで本リポジトリを自由に Fork し、ご自身向けにカスタマイズや派生版の公開を行っていただくことは大歓迎です。
- **ドキュメントについて**: 本 README はコードベースをもとに AI の補助を利用して作成し、手動で確認・修正を行っていますが、記載漏れや誤りが含まれる可能性があります。

---

## 謝辞

- **[ComfyUI-Autocomplete-Plus](https://github.com/newtextdoc1111/ComfyUI-Autocomplete-Plus)** (作者: [newtextdoc1111](https://github.com/newtextdoc1111) 氏) – Autocomplete++ のベースとなったオリジナル拡張機能。
- **[a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete)** (作者: [DominikDoom](https://github.com/DominikDoom) 氏) – 各種機能およびコンセプトの着想・参考元。

---

## ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。
