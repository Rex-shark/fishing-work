// 猜歌答案判定：spec/song-guess/architecture.md §4「答案判定」
// 歌名 fixture 取自真 iTunes 回應（台灣區 artistTerm 搜尋：孫燕姿、五月天、周杰倫、告五人、Taylor Swift、YOASOBI、aespa）與 spec 的範例。
import { describe, expect, it } from 'vitest';
import { containsSpoiler, isCorrect, mainTitle, normalizeFull, normalizeTitle, stripSubtitle, titleLength } from '../src/song-guess/answer';
import * as entry from '../src/song-guess';

describe('stripSubtitle：括號起的副標', () => {
  it('半形括號（前有空白）', () => {
    expect(stripSubtitle('如果可以 (電影"月老"主題曲)')).toBe('如果可以');
    expect(stripSubtitle('愛 (Live)')).toBe('愛');
    expect(stripSubtitle('晴天 (Live)')).toBe('晴天');
    expect(stripSubtitle('祝我生日快樂 (無與倫比演唱會對唱版)')).toBe('祝我生日快樂');
    expect(stripSubtitle('Look What You Made Me Do (Karaoke Version)')).toBe('Look What You Made Me Do');
  });

  it('括號前沒有空白', () => {
    expect(stripSubtitle('我是如此相信(電影《天火》主題曲)')).toBe('我是如此相信');
    expect(stripSubtitle('任性(電視劇《難哄》主題曲)')).toBe('任性');
  });

  it('全形括號、【】、[]', () => {
    expect(stripSubtitle('如果可以（電影《月老》主題曲）')).toBe('如果可以');
    expect(stripSubtitle('倔強【Live】')).toBe('倔強');
    expect(stripSubtitle('Lover [Remix]')).toBe('Lover');
  });

  it('多段副標：從第一個括號起全部去掉', () => {
    expect(stripSubtitle('Is It Over Now? (Taylor\'s Version) [From The Vault]')).toBe('Is It Over Now?');
    expect(stripSubtitle('Run (Taylor\'s Version) [From The Vault] [feat. Ed Sheeran]')).toBe('Run');
    expect(stripSubtitle('後來的我們 (電影《後來的我們》片名曲) [眼淚未乾版]')).toBe('後來的我們');
    expect(stripSubtitle('0X1=LOVESONG (I Know I Love You) [feat. LILAS IKUTA] [Japanese Version]')).toBe('0X1=LOVESONG');
  });

  it('彎引號的副標', () => {
    expect(stripSubtitle('Love Story (Taylor’s Version)')).toBe('Love Story');
  });
});

describe('stripSubtitle：「 - 」之後', () => {
  it('去掉「 - 」之後', () => {
    expect(stripSubtitle('夜に駆ける - From THE FIRST TAKE')).toBe('夜に駆ける');
    expect(stripSubtitle('Yellow - Live in Tokyo')).toBe('Yellow');
  });

  it('沒有前後空白的連字號不是副標', () => {
    expect(stripSubtitle('Biri-Biri')).toBe('Biri-Biri');
    expect(stripSubtitle('Anti-Hero')).toBe('Anti-Hero');
  });
});

describe('stripSubtitle：feat.／ft.／featuring（不分大小寫）', () => {
  it('括號裡的 feat. 由括號規則去掉', () => {
    expect(stripSubtitle("I'm gonna TOESA (feat. Kian84)")).toBe("I'm gonna TOESA");
    expect(stripSubtitle('珊瑚海 (feat. 梁心頤)')).toBe('珊瑚海');
    expect(stripSubtitle('青春謳歌 (feat.ano)')).toBe('青春謳歌');
  });

  it('沒有括號的 feat.', () => {
    expect(stripSubtitle('Free Free Free feat. 幾田りら')).toBe('Free Free Free');
    expect(stripSubtitle('溫柔feat.孫燕姿')).toBe('溫柔');
  });

  it('ft. 與 featuring、大小寫', () => {
    expect(stripSubtitle('Stay ft. Somebody')).toBe('Stay');
    expect(stripSubtitle('Stay FT. Somebody')).toBe('Stay');
    expect(stripSubtitle('Stay Feat. Somebody')).toBe('Stay');
    expect(stripSubtitle('Stay FEATURING Somebody')).toBe('Stay');
    expect(stripSubtitle('Stay featuring Somebody')).toBe('Stay');
  });

  it('英文單字裡剛好含 ft.／feat 不算（前一個字是英文字母、或沒有句點）', () => {
    expect(stripSubtitle('Left. Right')).toBe('Left. Right');
    expect(stripSubtitle('Gift.')).toBe('Gift.');
    expect(stripSubtitle('Defeat')).toBe('Defeat');
    expect(stripSubtitle('Feature Film')).toBe('Feature Film');
    expect(stripSubtitle('Featurings')).toBe('Featurings');
  });

  it('三種起點取最前面的', () => {
    expect(stripSubtitle('A - B (C) feat. D')).toBe('A');
    expect(stripSubtitle('A feat. B - C (D)')).toBe('A');
    expect(stripSubtitle('A (B) - C')).toBe('A');
  });
});

describe('stripSubtitle：去副標後為空 → 退回原歌名（去頭尾空白）', () => {
  it('括號在開頭', () => {
    expect(stripSubtitle('(......醉鬼阿Q) [feat. 孫燕姿]')).toBe('(......醉鬼阿Q) [feat. 孫燕姿]');
    expect(stripSubtitle('(......醉鬼阿Q) (feat. 孫燕姿)')).toBe('(......醉鬼阿Q) (feat. 孫燕姿)');
    expect(stripSubtitle("  (I Can't Get No) Satisfaction ")).toBe("(I Can't Get No) Satisfaction");
  });

  it('feat. 在開頭', () => {
    expect(stripSubtitle('feat. 某人')).toBe('feat. 某人');
  });

  it('沒有副標的歌名只去頭尾空白', () => {
    expect(stripSubtitle('  我不難過 ')).toBe('我不難過');
    expect(stripSubtitle('"Slut!"')).toBe('"Slut!"');
    expect(stripSubtitle('')).toBe('');
  });
});

describe('normalizeTitle／normalizeFull', () => {
  it('spec 範例', () => {
    expect(normalizeTitle("I'm gonna TOESA")).toBe('imgonnatoesa');
    expect(normalizeTitle("I'm gonna TOESA (feat. Kian84)")).toBe('imgonnatoesa');
    expect(normalizeTitle('如果可以 (電影"月老"主題曲)')).toBe('如果可以');
  });

  it('NFKC：全形英數、半形片假名', () => {
    expect(normalizeTitle('ＬＯＶＥ　１２３')).toBe('love123');
    expect(normalizeTitle('ｱｲﾄﾞﾙ')).toBe(normalizeTitle('アイドル'));
  });

  it('空白（半形、全形、tab）全部移除', () => {
    expect(normalizeTitle(' Love   Story\t')).toBe('lovestory');
    expect(normalizeTitle('天　黑　黑')).toBe('天黑黑');
  });

  it('標點與符號（\\p{P}、\\p{S}）全部移除：半形、全形、彎引號', () => {
    expect(normalizeTitle('ME!')).toBe('me');
    expect(normalizeTitle('Is It Over Now?')).toBe('isitovernow');
    expect(normalizeTitle('I Don’t Wanna Live Forever')).toBe('idontwannaliveforever');
    expect(normalizeTitle("I Don't Wanna Live Forever")).toBe('idontwannaliveforever');
    expect(normalizeTitle('0X1=LOVESONG')).toBe('0x1lovesong');
    expect(normalizeTitle('你不是真正的快樂+天空')).toBe('你不是真正的快樂天空');
    expect(normalizeTitle('愛，很簡單。')).toBe('愛很簡單');
    expect(normalizeTitle('"Slut!"')).toBe('slut');
    expect(normalizeTitle('Biri-Biri')).toBe('biribiri');
  });

  it('英文小寫', () => {
    expect(normalizeTitle('PLAYERS')).toBe('players');
    expect(normalizeTitle('Shake It Off')).toBe('shakeitoff');
  });

  it('日文、韓文維持原樣', () => {
    expect(normalizeTitle('夜に駆ける')).toBe('夜に駆ける');
    expect(normalizeTitle('ツバメ (feat. ミドリーズ)')).toBe('ツバメ');
    expect(normalizeTitle('도깨비불')).toBe('도깨비불'.normalize('NFKC'));
  });

  it('normalizeFull 不去副標，其餘相同', () => {
    expect(normalizeFull('愛 (Live)')).toBe('愛live');
    expect(normalizeFull('如果可以 (電影"月老"主題曲)')).toBe('如果可以電影月老主題曲');
    expect(normalizeFull('Love Story (Taylor’s Version)')).toBe('lovestorytaylorsversion');
    expect(normalizeFull('夜に駆ける - From THE FIRST TAKE')).toBe('夜に駆けるfromthefirsttake');
  });

  it('去副標後為空的歌名：兩者相同（都是整個歌名）', () => {
    expect(normalizeTitle('(......醉鬼阿Q) [feat. 孫燕姿]')).toBe('醉鬼阿qfeat孫燕姿');
    expect(normalizeFull('(......醉鬼阿Q) [feat. 孫燕姿]')).toBe('醉鬼阿qfeat孫燕姿');
  });

  it('純符號、純空白正規化為空字串', () => {
    expect(normalizeTitle('...')).toBe('');
    expect(normalizeTitle('？！')).toBe('');
    expect(normalizeTitle(' 　 ')).toBe('');
    expect(normalizeTitle('(...)')).toBe('');
    expect(normalizeFull('♥ ★')).toBe('');
  });
});

describe('isCorrect', () => {
  it('只打歌名本身算對（驗收標準：「如果可以」）', () => {
    expect(isCorrect('如果可以', '如果可以 (電影"月老"主題曲)')).toBe(true);
    expect(isCorrect('我是如此相信', '我是如此相信(電影《天火》主題曲)')).toBe(true);
    expect(isCorrect('愛', '愛 (Live)')).toBe(true);
    expect(isCorrect('夜に駆ける', '夜に駆ける - From THE FIRST TAKE')).toBe(true);
    expect(isCorrect('love story', 'Love Story (Taylor’s Version)')).toBe(true);
    expect(isCorrect('im gonna toesa', "I'm gonna TOESA (feat. Kian84)")).toBe(true);
  });

  it('打完整歌名（含副標）也算對', () => {
    expect(isCorrect('如果可以 (電影"月老"主題曲)', '如果可以 (電影"月老"主題曲)')).toBe(true);
    expect(isCorrect('愛 (Live)', '愛 (Live)')).toBe(true);
    expect(isCorrect("Love Story (Taylor's Version)", 'Love Story (Taylor’s Version)')).toBe(true);
    expect(isCorrect('夜に駆ける - From THE FIRST TAKE', '夜に駆ける - From THE FIRST TAKE')).toBe(true);
  });

  it('打完整歌名但省略括號、標點也算對（normalizeFull）', () => {
    expect(isCorrect('愛 live', '愛 (Live)')).toBe(true);
    expect(isCorrect('love story taylors version', 'Love Story (Taylor’s Version)')).toBe(true);
    expect(isCorrect('如果可以電影月老主題曲', '如果可以 (電影"月老"主題曲)')).toBe(true);
  });

  it('副標打錯：去副標後相同仍算對（玩家自己加的括號也會被去掉）', () => {
    expect(isCorrect('愛 (錄音室版)', '愛 (Live)')).toBe(true);
  });

  it('全形、空白、標點、大小寫不同仍算對', () => {
    expect(isCorrect('ＬＯＶＥ　ＳＴＯＲＹ', 'Love Story')).toBe(true);
    expect(isCorrect('天 黑 黑', '天黑黑')).toBe(true);
    expect(isCorrect('me', 'ME! (feat. Brendon Urie of Panic! At The Disco)')).toBe(true);
    expect(isCorrect('Is it over now', "Is It Over Now? (Taylor's Version) [From The Vault]")).toBe(true);
    expect(isCorrect('i dont wanna live forever', 'I Don’t Wanna Live Forever (Fifty Shades Darker)')).toBe(true);
    expect(isCorrect('SHAKE IT OFF', "Shake It Off (Taylor's Version)")).toBe(true);
    expect(isCorrect('0x1 lovesong', '0X1=LOVESONG (I Know I Love You) [feat. LILAS IKUTA] [Japanese Version]')).toBe(true);
  });

  it('多字、少字、別首歌不算', () => {
    expect(isCorrect('是如果可以嗎', '如果可以 (電影"月老"主題曲)')).toBe(false);
    expect(isCorrect('如果', '如果可以 (電影"月老"主題曲)')).toBe(false);
    expect(isCorrect('電影月老主題曲', '如果可以 (電影"月老"主題曲)')).toBe(false);
    expect(isCorrect('Live', '愛 (Live)')).toBe(false);
    expect(isCorrect('遇見', '天黑黑')).toBe(false);
  });

  it('去副標後為空的歌名：要打整個歌名（括號與標點可省略）', () => {
    const title = '(......醉鬼阿Q) [feat. 孫燕姿]';
    expect(isCorrect(title, title)).toBe(true);
    expect(isCorrect('醉鬼阿Q feat 孫燕姿', title)).toBe(true);
    expect(isCorrect('醉鬼阿Q', title)).toBe(false);
  });

  it('正規化後為空字串一律不算', () => {
    expect(isCorrect('', '')).toBe(false);
    expect(isCorrect('...', '...')).toBe(false);
    expect(isCorrect('   ', '愛')).toBe(false);
    expect(isCorrect('！？', '？！')).toBe(false);
    expect(isCorrect('愛', '(...)')).toBe(false);
  });
});

describe('containsSpoiler', () => {
  it('訊息含歌名本身（去副標）即洩題', () => {
    expect(containsSpoiler('答案是如果可以啦', '如果可以 (電影"月老"主題曲)')).toBe(true);
    expect(containsSpoiler('是 Love  Story 嗎', 'Love Story (Taylor’s Version)')).toBe(true);
    expect(containsSpoiler('夜に駆ける！', '夜に駆ける - From THE FIRST TAKE')).toBe(true);
  });

  it('訊息不去副標：括號裡提到歌名也算', () => {
    expect(containsSpoiler('我猜（如果可以）', '如果可以 (電影"月老"主題曲)')).toBe(true);
    expect(containsSpoiler('不知道 - 如果可以？', '如果可以 (電影"月老"主題曲)')).toBe(true);
    expect(containsSpoiler('某首 feat. 如果可以', '如果可以 (電影"月老"主題曲)')).toBe(true);
  });

  it('以空白、標點、全形、大小寫拆開仍算', () => {
    expect(containsSpoiler('如 果 可 以', '如果可以')).toBe(true);
    expect(containsSpoiler('如.果.可.以', '如果可以')).toBe(true);
    expect(containsSpoiler('ｌｏｖｅ－ｓｔｏｒｙ', 'Love Story')).toBe(true);
    expect(containsSpoiler('IM GONNA TOESA!!', "I'm gonna TOESA (feat. Kian84)")).toBe(true);
  });

  it('只提到副標不算洩題', () => {
    expect(containsSpoiler('是電影月老的主題曲', '如果可以 (電影"月老"主題曲)')).toBe(false);
    expect(containsSpoiler('這首有 Taylor’s Version', 'Love Story (Taylor’s Version)')).toBe(false);
  });

  it('不含歌名不算', () => {
    expect(containsSpoiler('這首好熟', '如果可以')).toBe(false);
    expect(containsSpoiler('如果', '如果可以')).toBe(false);
    expect(containsSpoiler('', '如果可以')).toBe(false);
  });

  it('單字歌名：訊息含那個字就算（比照我畫你猜）', () => {
    expect(containsSpoiler('我愛你', '愛 (Live)')).toBe(true);
  });

  it('歌名正規化後為空字串時不視為洩題', () => {
    expect(containsSpoiler('隨便說什麼', '...')).toBe(false);
    expect(containsSpoiler('', '')).toBe(false);
  });

  it('猜對的字串必然含歌名（room 對已猜對者只需判 containsSpoiler）', () => {
    const cases: [string, string][] = [
      ['如果可以', '如果可以 (電影"月老"主題曲)'],
      ['愛 live', '愛 (Live)'],
      ['愛 (錄音室版)', '愛 (Live)'],
      ['醉鬼阿Q feat 孫燕姿', '(......醉鬼阿Q) [feat. 孫燕姿]'],
      ["Love Story (Taylor's Version)", 'Love Story (Taylor’s Version)'],
    ];
    for (const [guess, title] of cases) {
      expect(isCorrect(guess, title)).toBe(true);
      expect(containsSpoiler(guess, title)).toBe(true);
    }
  });
});

describe('titleLength：normalizeTitle 的 code point 數（去副標、不含空白與標點）', () => {
  it('spec 範例', () => {
    expect(titleLength('My story, your song')).toBe(15);
    expect(titleLength('如果可以 (電影"月老"主題曲)')).toBe(4);
  });

  it('中文、日文：去副標後的字數', () => {
    expect(titleLength('愛 (Live)')).toBe(1);
    expect(titleLength('我是如此相信(電影《天火》主題曲)')).toBe(6);
    expect(titleLength('夜に駆ける - From THE FIRST TAKE')).toBe(5);
    expect(titleLength('天　黑　黑')).toBe(3);
    expect(titleLength('愛，很簡單。')).toBe(4);
  });

  it('英文：空白與標點不算（與玩家要打對的字數一致）', () => {
    expect(titleLength("I'm gonna TOESA (feat. Kian84)")).toBe(12);
    expect(titleLength('Love Story (Taylor’s Version)')).toBe(9);
    expect(titleLength('ME! (feat. Brendon Urie of Panic! At The Disco)')).toBe(2);
    expect(titleLength('Is It Over Now? (Taylor\'s Version) [From The Vault]')).toBe(11);
    expect(titleLength('0X1=LOVESONG (I Know I Love You) [feat. LILAS IKUTA] [Japanese Version]')).toBe(11);
  });

  it('全形英數以 NFKC 後計；符號類 emoji 不算', () => {
    expect(titleLength('ＬＯＶＥ　１２３')).toBe(7);
    expect(titleLength('愛🎵 (Live)')).toBe(1);
  });

  it('永遠等於 normalizeTitle 的 code point 數', () => {
    for (const title of ['遇見', "I'm gonna TOESA (feat. Kian84)", '溫柔 #MaydayBlue20th (feat.孫燕姿)', '(......醉鬼阿Q) [feat. 孫燕姿]', '...']) {
      expect(titleLength(title)).toBe([...normalizeTitle(title)].length);
    }
    // 括號開頭的歌名（picker 會排除）：整個歌名正規化後的字數
    expect(titleLength('(......醉鬼阿Q) [feat. 孫燕姿]')).toBe(11);
    expect(titleLength('...')).toBe(0);
  });
});

describe('mainTitle：歌名本身（去副標後為空時不退回）', () => {
  it('有歌名本身時與 stripSubtitle 相同', () => {
    for (const title of ['如果可以 (電影"月老"主題曲)', "I'm gonna TOESA (feat. Kian84)", '夜に駆ける - From THE FIRST TAKE', '  我不難過 ', 'Free Free Free feat. 幾田りら', 'Left. Right']) {
      expect(mainTitle(title)).toBe(stripSubtitle(title));
      expect(mainTitle(title)).not.toBe('');
    }
  });

  it('括號開頭、feat. 開頭、空字串 → 空字串（stripSubtitle 則退回原歌名）', () => {
    for (const title of ['(......醉鬼阿Q) [feat. 孫燕姿]', '(......醉鬼阿Q) (feat. 孫燕姿)', "(I Can't Get No) Satisfaction", '【Live】倔強', '  （前奏）', 'feat. 某人', '', '   ']) {
      expect(mainTitle(title)).toBe('');
      expect(stripSubtitle(title)).toBe(title.trim());
    }
  });

  it('純符號歌名不是「去副標後為空」（由 normalizeTitle 為空來排除）', () => {
    expect(mainTitle('...')).toBe('...');
    expect(normalizeTitle('...')).toBe('');
  });
});

describe('從 song-guess 入口匯出', () => {
  it('入口帶答案判定的六個函式與 picker 用的 mainTitle', () => {
    expect(entry.stripSubtitle).toBe(stripSubtitle);
    expect(entry.normalizeTitle).toBe(normalizeTitle);
    expect(entry.normalizeFull).toBe(normalizeFull);
    expect(entry.isCorrect).toBe(isCorrect);
    expect(entry.containsSpoiler).toBe(containsSpoiler);
    expect(entry.titleLength).toBe(titleLength);
    expect(entry.mainTitle).toBe(mainTitle);
  });
});
