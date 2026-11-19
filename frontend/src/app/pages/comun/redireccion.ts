import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth.service';

@Component({ selector: 'app-redireccion', template: '' })
export class Redireccion implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);
  ngOnInit() { this.router.navigateByUrl(this.auth.inicio(), { replaceUrl: true }); }
}
