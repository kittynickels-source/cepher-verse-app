# Cepher Verse App (GitHub Pages build)

Live: https://kittynickels-source.github.io/cepher-verse-app/

Static web build of the Bible verse app: tap a Cepher-style name (Elohiym, Yahuah, Yahusha…) to see its Hebrew
(Frank Ruhl Libre) in a bubble with pronunciation, meaning and audio; verse-of-the-day card; chapter reader; Learn mode.

- **The decryption key is NOT included in this repository.** `versions/*.enc` are AES-encrypted Bible texts.
  The Today and Reader pages ask you to paste the key or pick the key file; it is held in memory for that visit only
  and never stored. In a native app the key would come from Android Keystore / iOS Keychain.
- The demo (`demo.html`), the Hebrew bubble and Learn mode work without the key.
- The Bible texts (KJV, Webster, ASV, WEB, Darby, YLT, BBE, DRA, OEB, BSB) are public domain. BSB: Berean Standard Bible, dedicated to the public domain (text from https://bereanbible.com/bsb.txt).
- Fonts: Literata and Frank Ruhl Libre, SIL Open Font License 1.1 (see `fonts/`).
