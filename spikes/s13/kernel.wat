;; S13 vector kernel (ARCH R14). Vectors are stored as int8 (a quarter of the bytes of float32) with a per-vector scale; this scans them.
;; dot8: for `count` vectors of 384 int8 lying end to end from `vec`, against one query of 384 int16 at `q`, writes the int32 dot product of each from `out`.
;; (The caller multiplies by the two scales and reranks the best candidates exactly with the float32 vectors.) All three are byte addresses in the imported memory.
;; Per turn of the inner loop: 16 int8 are widened to int16 as two halves (v128.load8x8_s), each dotted with 8 int16 of the query by i32x4.dot_i16x8_s, into two accumulators.
;; Largest sum is 384 * 127 * 127 = 6.2 million, far inside int32. 384 = 24 turns, no tail. Assembled on the runner by spikes/s13/assemble.ts (wabt, simd on).
(module
  (import "e" "m" (memory 1))

  (func (export "dot8") (param $vec i32) (param $q i32) (param $count i32) (param $out i32)
    (local $acc0 v128) (local $acc1 v128)
    (local $qp i32) (local $qend i32) (local $end i32)

    ;; end = out + count * 4 ; qend = q + 384 * 2
    (local.set $end (i32.add (local.get $out) (i32.shl (local.get $count) (i32.const 2))))
    (local.set $qend (i32.add (local.get $q) (i32.const 768)))

    (block $done
      (loop $next_vector
        (br_if $done (i32.ge_u (local.get $out) (local.get $end)))
        (local.set $acc0 (v128.const i32x4 0 0 0 0))
        (local.set $acc1 (v128.const i32x4 0 0 0 0))
        (local.set $qp (local.get $q))

        (loop $next_sixteen
          (local.set $acc0 (i32x4.add (local.get $acc0)
            (i32x4.dot_i16x8_s (v128.load8x8_s offset=0 (local.get $vec)) (v128.load offset=0 (local.get $qp)))))
          (local.set $acc1 (i32x4.add (local.get $acc1)
            (i32x4.dot_i16x8_s (v128.load8x8_s offset=8 (local.get $vec)) (v128.load offset=16 (local.get $qp)))))
          (local.set $vec (i32.add (local.get $vec) (i32.const 16)))
          (local.set $qp (i32.add (local.get $qp) (i32.const 32)))
          (br_if $next_sixteen (i32.lt_u (local.get $qp) (local.get $qend))))

        (local.set $acc0 (i32x4.add (local.get $acc0) (local.get $acc1)))
        (i32.store (local.get $out)
          (i32.add
            (i32.add (i32x4.extract_lane 0 (local.get $acc0)) (i32x4.extract_lane 1 (local.get $acc0)))
            (i32.add (i32x4.extract_lane 2 (local.get $acc0)) (i32x4.extract_lane 3 (local.get $acc0)))))
        (local.set $out (i32.add (local.get $out) (i32.const 4)))
        (br $next_vector))))
)
