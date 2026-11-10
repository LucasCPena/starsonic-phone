#include "Bunzip.h"

#include <bzlib.h>

#include <algorithm>
#include <limits>
#include <new>

std::optional<std::string> Bunzip2(const std::string& compressed, size_t maxOut) {
    if (compressed.empty()) return std::nullopt;
    bz_stream stream = {};
    if (BZ2_bzDecompressInit(&stream, 0, 0) != BZ_OK) return std::nullopt;

    const size_t kChunk = 64 * 1024;
    const size_t kUnsigned = std::numeric_limits<unsigned int>::max();
    std::string out;
    size_t consumed = 0;
    bool ended = false;
    bool ok = true;
    try {
        while (ok && !ended) {
            const size_t room = maxOut - out.size();
            // Um byte a mais que o limite: se ele sair, a saida passou do maxOut.
            const size_t want = std::min(kChunk, room + 1);
            const size_t before = out.size();
            out.resize(before + want);
            const size_t left = std::min(compressed.size() - consumed, kUnsigned);
            stream.next_in = const_cast<char*>(compressed.data()) + consumed;
            stream.avail_in = static_cast<unsigned int>(left);
            stream.next_out = &out[before];
            stream.avail_out = static_cast<unsigned int>(want);
            const int result = BZ2_bzDecompress(&stream);
            const size_t produced = want - stream.avail_out;
            consumed += left - stream.avail_in;
            out.resize(before + produced);
            if (out.size() > maxOut) {
                ok = false;
            } else if (result == BZ_STREAM_END) {
                ended = true;
            } else if (result != BZ_OK) {
                ok = false;
            } else if (produced == 0 && left == stream.avail_in && stream.avail_in == 0) {
                ok = false;   // sem entrada e sem progresso: o fluxo foi cortado
            }
        }
    } catch (const std::bad_alloc&) {
        ok = false;
    }
    BZ2_bzDecompressEnd(&stream);
    // Bytes depois do fim do fluxo: o arquivo nao e o que a Cisco publicou.
    if (!ok || !ended || consumed != compressed.size()) return std::nullopt;
    return out;
}
