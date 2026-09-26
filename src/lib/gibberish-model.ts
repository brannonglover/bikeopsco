/**
 * Character bigram model used to tell typed-by-a-person text from the random
 * letter strings an automated form filler submits. Generated data — do not
 * hand-edit. Regenerate with `node scripts/build-gibberish-model.js`, which
 * also prints the score separation the threshold relies on.
 *
 * Trained on 234,430 dictionary words and proper names plus 382 weighted
 * entries covering bike brands and names the system word list misses.
 */

/** Boundary symbol plus a-z; index 0 marks the start and end of a word. */
export const ALPHABET_SIZE = 27;

const QUANT_SCALE = 18;
const QUANT_FLOOR = -14;

const PACKED_TABLE =
  "B8jCzMe/v7/Ct7LDwMi/wMyVx9TItri6oLG00JK+w8Suo7W3xZK61cXftLds0MTNoLKoh62nvdW/i7LdeG+73Lxb0bB51YBN16ORwXpxKpdHz9pIoq7QOzvd0R7Iv1961k5xxKfJwB5JHrWi3tWodp/dhJWJ2HxdtrWg2KdGypWzxampI7lZ3bivwsOxqKOJvG+nzMHVtLGB3cu9r7WqoLO91N9uYGnZx2Jx0FJdyrlv1GI1u3qu1UJzub5O5cx8XHbWc6bIzUBcwrDF1GonyI2s0Tt/J7hO1eR/bnLYgWZw1T9gscC82HhCun6nxlepIslF0s26zcXDrbx2fZW8y73axa+XvtLKor1fqpWxc+NN2F7fQUFk2VRNVFRe31RBaEFNzUFNQWRB3deCamrUf1/N3V2toIOx2awowLqBr1DFKLA819mHra/ciYt02juh0a6szaY+bcC3uax5McyczuO9uWfZe1my2kRVhbuZ2sg1bYalwWamIbY+5M6OwMnRnNaNzJmuko61ypV6k8TPrI+cX6ma07S4wLmjrrilvqmsycfdusNy0cjBybvCk4SqsNd9dGXgeWjU0qlpv36R1Lk52cDHsz9+Jqkmem1aWlptWlpad1paWlpabVpmZlpa/FpaWlpa1dyts7LToLmZ16WvtbW62aBjvMC3t6+JObWx2sl6yG/UnHDJzFrGvrWmyLygctDUyaaPFqmy1dagpmraiHDL21idpIyI1npD2JG6w1+QJrxzysDFt7XKqrBrvKW+0MTZw71Y0drAXISkg6Wx1+IwST3oMLQw1DBEVjBR2jAwcFgwt18wMIBJ0uSLco3VgnDA0kCGu4Sl23pHoNqEuEB8M4hg58SJuHe9inKi40xgj4h2vr53cpXX0mCGTL9Z7NCQu6jSg6GFtEOuuse7xbhKrsm7wl6JhkeC5dC3XWXfR1nUxzO3uFNQtkwzW1nDxEddM9GY";

/** Row-major [prev][next] table of bigram log probabilities. */
export const BIGRAM_LOG_PROBS: Float64Array = (() => {
  const raw =
    typeof atob === "function"
      ? Uint8Array.from(atob(PACKED_TABLE), (c) => c.charCodeAt(0))
      : new Uint8Array(Buffer.from(PACKED_TABLE, "base64"));
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] / QUANT_SCALE + QUANT_FLOOR;
  }
  return out;
})();
