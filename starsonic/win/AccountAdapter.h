#pragma once
// Conversao entre as estruturas do MicroSIP (Account, AccountSettings) e as do nucleo.
#include "AccountPolicy.h"

struct Account;
struct AccountSettings;

starsonic::AccountFields ToFields(const Account& account, const CString& serverId);
void FromFields(const starsonic::AccountFields& fields, Account* account);

// Chave starsonicServer de [Account<id>] em accountSettings.iniFile.
CString ReadServerId(int accountId);
void WriteServerId(int accountId, const CString& serverId);   // vazio apaga a chave

starsonic::GlobalFields GlobalsFrom(const AccountSettings& settings);
void GlobalsTo(const starsonic::GlobalFields& globals, AccountSettings* settings);
