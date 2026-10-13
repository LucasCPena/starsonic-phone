#pragma once
// Conversao entre as estruturas do MicroSIP (Account, AccountSettings) e as do nucleo.
#include "AccountPolicy.h"

struct Account;
struct AccountSettings;

starsonic::AccountFields ToFields(const Account& account);
void FromFields(const starsonic::AccountFields& fields, Account* account);

starsonic::GlobalFields GlobalsFrom(const AccountSettings& settings);
void GlobalsTo(const starsonic::GlobalFields& globals, AccountSettings* settings);
