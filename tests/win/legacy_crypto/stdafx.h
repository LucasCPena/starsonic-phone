#pragma once
// O cabecalho pre-compilado minimo para compilar o microsip/lib/Crypto.cpp original (que inclui "stdafx.h") no teste
// da senha da rc.7: so o MFC que o CCrypto usa (CString, CByteArray, CMemFile, CArchive), mais o AfxWinInit.
#ifndef VC_EXTRALEAN
#define VC_EXTRALEAN
#endif
#define _ATL_CSTRING_EXPLICIT_CONSTRUCTORS   // como o microsip/stdafx.h

#include <afxwin.h>
#include <wincrypt.h>
