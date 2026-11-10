%% 极简 JSON 编码器：只负责编码服务器发出的数据。
-module(vs_json).
-export([encode/1]).

encode(true) -> <<"true">>;
encode(false) -> <<"false">>;
encode(null) -> <<"null">>;
encode(A) when is_atom(A) -> encode_string(atom_to_binary(A, utf8));
encode(I) when is_integer(I) -> integer_to_binary(I);
encode(F) when is_float(F) ->
    R = round(F * 10),
    case R rem 10 of
        0 -> integer_to_binary(R div 10);
        _ -> float_to_binary(R / 10, [{decimals, 1}, compact])
    end;
encode(B) when is_binary(B) -> encode_string(B);
encode(M) when is_map(M) ->
    Pairs = [[encode_key(K), $:, encode(V)] || {K, V} <- maps:to_list(M)],
    [${, lists:join($,, Pairs), $}];
encode(L) when is_list(L) ->
    [$[, lists:join($,, [encode(X) || X <- L]), $]].

encode_key(K) when is_atom(K) -> encode_string(atom_to_binary(K, utf8));
encode_key(K) when is_binary(K) -> encode_string(K);
encode_key(K) when is_integer(K) -> encode_string(integer_to_binary(K)).

encode_string(B) ->
    [$", escape(B, <<>>), $"].

escape(<<>>, Acc) -> Acc;
escape(<<$", R/binary>>, Acc) -> escape(R, <<Acc/binary, "\\\"">>);
escape(<<$\\, R/binary>>, Acc) -> escape(R, <<Acc/binary, "\\\\">>);
escape(<<$\n, R/binary>>, Acc) -> escape(R, <<Acc/binary, "\\n">>);
escape(<<C, R/binary>>, Acc) when C < 16#20 ->
    Hex = list_to_binary(io_lib:format("\\u~4.16.0b", [C])),
    escape(R, <<Acc/binary, Hex/binary>>);
escape(<<C, R/binary>>, Acc) -> escape(R, <<Acc/binary, C>>).
